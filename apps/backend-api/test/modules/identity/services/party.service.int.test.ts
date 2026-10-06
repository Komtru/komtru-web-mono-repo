// M1 §8 against the real database, because almost everything that makes party lookup safe is a
// property of the QUERY: that there is one of it whatever the channel, that it never reaches
// `username_history`, and that the visibility decision happens after the row is already in hand.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../src/platform/errors.js';
import type { LookupKey } from '../../../../src/modules/identity/domain/party/lookup.js';
import { NO_LOOKUP_BUDGET } from '../../../../src/modules/identity/infrastructure/redis/lookup-budget.js';
import {
  lookupParty,
  suggestParties,
  type PartyDeps,
} from '../../../../src/modules/identity/services/party.service.js';
import { skeleton } from '../../../../src/modules/identity/domain/username/skeleton.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { TYPEAHEAD_HANDLES, insertUser } from '../infrastructure/postgres/support.js';

interface SeedOptions {
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  status?: string;
  verificationLevel?: string;
  discoverableByUsername?: boolean;
  discoverableByEmail?: boolean;
  discoverableByPhone?: boolean;
  merchant?: string | null;
  displayName?: string | null;
}

describe.runIf(infraEnabled)('party service (M1 §8)', () => {
  const t = useTestDatabase();

  const seedParty = async (options: SeedOptions = {}): Promise<string> => {
    const {
      username = null,
      email = null,
      phone = null,
      emailVerified = true,
      phoneVerified = true,
      status = 'ACTIVE',
      verificationLevel = 'CONTACT_VERIFIED',
      discoverableByUsername = true,
      discoverableByEmail = true,
      discoverableByPhone = true,
      merchant = null,
      displayName = null,
    } = options;

    const userId = await insertUser(t.owner(), {
      status,
      verification_level: verificationLevel,
      discoverable_by_username: discoverableByUsername,
      discoverable_by_email: discoverableByEmail,
      discoverable_by_phone: discoverableByPhone,
      ...(username ? { username, username_skeleton: skeleton(username) } : {}),
    });
    if (email) {
      await t.owner().query(
        `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
           VALUES ($1, $2, $2, true, $3)`,
        [userId, email, emailVerified ? new Date() : null],
      );
    }
    if (phone) {
      await t.owner().query(
        `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
           VALUES ($1, $2, 'NG', true, $3)`,
        [userId, phone, phoneVerified ? new Date() : null],
      );
    }
    if (displayName) {
      await t
        .owner()
        .query(`INSERT INTO identity.user_profiles (user_id, display_name) VALUES ($1, $2)`, [
          userId,
          displayName,
        ]);
    }
    if (merchant) {
      await t
        .owner()
        .query(
          `INSERT INTO identity.user_capabilities (user_id, capability, status) VALUES ($1, 'MERCHANT', $2)`,
          [userId, merchant],
        );
    }
    return userId;
  };

  /** A caller who passes §8.3 control 2. */
  const seedCaller = (): Promise<string> =>
    insertUser(t.owner(), { status: 'ACTIVE', verification_level: 'CONTACT_VERIFIED' });

  const deps = (overrides: Partial<PartyDeps> = {}): PartyDeps => ({
    db: t.db(),
    budget: NO_LOOKUP_BUDGET,
    ...overrides,
  });

  const lookup = (actorUserId: string, key: LookupKey, overrides: Partial<PartyDeps> = {}) =>
    lookupParty(deps(overrides), { actorUserId, ip: '198.51.100.7', key });

  const MISS = { found: false, canInvite: true, maskedHint: null };

  const events = async (pool: pg.Pool) => {
    const { rows } = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM platform.outbox ORDER BY occurred_at, event_id`,
    );
    return rows;
  };

  describe('resolution (§8.1)', () => {
    it('returns the card for a handle, an email and a phone', async () => {
      const caller = await seedCaller();
      await seedParty({
        username: 'janedoe',
        email: 'jane@example.com',
        phone: '+2348023415567',
        displayName: 'Jane D.',
      });

      for (const key of [
        { channel: 'USERNAME', canonical: 'janedoe' },
        { channel: 'EMAIL', canonical: 'jane@example.com' },
        { channel: 'PHONE', canonical: '+2348023415567' },
      ] as LookupKey[]) {
        const result = await lookup(caller, key);
        expect(result).toMatchObject({ found: true });
        if (result.found) {
          expect(result.party).toMatchObject({
            username: 'janedoe',
            displayName: 'Jane D.',
            canBuy: true,
            isMerchant: false,
            badges: ['EMAIL_VERIFIED', 'PHONE_VERIFIED'],
          });
        }
      }
    });

    it('matches the email through the provider-normalised form', async () => {
      const caller = await seedCaller();
      await seedParty({ email: 'jane@gmail.com' });
      // What the caller typed is normalised by the route; what reaches here is the canonical form.
      expect(await lookup(caller, { channel: 'EMAIL', canonical: 'jane@gmail.com' })).toMatchObject({
        found: true,
      });
    });

    it('never resolves an unverified contact', async () => {
      // An unverified address is not unique — two accounts may each claim it — so resolving a
      // counterparty through one would be ambiguous at best.
      const caller = await seedCaller();
      await seedParty({ email: 'jane@example.com', emailVerified: false });
      expect(await lookup(caller, { channel: 'EMAIL', canonical: 'jane@example.com' })).toEqual(MISS);
    });

    it('says a username miss cannot be invited', async () => {
      const caller = await seedCaller();
      expect(await lookup(caller, { channel: 'USERNAME', canonical: 'nobody' })).toEqual({
        found: false,
        canInvite: false,
        maskedHint: null,
      });
    });

    it('carries canBuy false and isMerchant true for a certified merchant (design §6.3)', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janesgadgets', merchant: 'ACTIVE' });
      const result = await lookup(caller, { channel: 'USERNAME', canonical: 'janesgadgets' });
      expect(result).toMatchObject({ found: true });
      if (result.found) expect(result.party).toMatchObject({ canBuy: false, isMerchant: true });
    });
  });

  describe('anti-enumeration (§8.3)', () => {
    it('answers a miss, a hidden user and a suspended user with one identical body', async () => {
      const caller = await seedCaller();
      await seedParty({ email: 'hidden@example.com', discoverableByEmail: false });
      await seedParty({ email: 'suspended@example.com', status: 'SUSPENDED' });

      const miss = await lookup(caller, { channel: 'EMAIL', canonical: 'nobody@example.com' });
      const hidden = await lookup(caller, { channel: 'EMAIL', canonical: 'hidden@example.com' });
      const suspended = await lookup(caller, { channel: 'EMAIL', canonical: 'suspended@example.com' });

      expect(miss).toEqual(MISS);
      expect(hidden).toEqual(miss);
      expect(suspended).toEqual(miss);
    });

    it('hides on the queried channel only', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe', email: 'jane@example.com', discoverableByEmail: false });

      expect(await lookup(caller, { channel: 'EMAIL', canonical: 'jane@example.com' })).toEqual(MISS);
      expect(await lookup(caller, { channel: 'USERNAME', canonical: 'janedoe' })).toMatchObject({
        found: true,
      });
    });

    it('does not resolve a handle its owner has released', async () => {
      // T-033 moves the old handle to username_history with a quarantine. A lookup that consulted
      // that table would hand the previous owner's card to whoever typed the retired handle.
      const caller = await seedCaller();
      const userId = await seedParty({ username: 'dellshop' });
      await t.owner().query(
        `INSERT INTO identity.username_history (user_id, username, username_skeleton, claimed_at, released_at, quarantine_until)
         VALUES ($1, 'dellstore', $2, now() - interval '10 days', now(), now() + interval '90 days')`,
        [userId, skeleton('dellstore')],
      );

      expect(await lookup(caller, { channel: 'USERNAME', canonical: 'dellstore' })).toEqual({
        found: false,
        canInvite: false,
        maskedHint: null,
      });
    });

    it('publishes identity.party.lookup_performed on a hit AND on a miss', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe' });

      await lookup(caller, { channel: 'USERNAME', canonical: 'janedoe' });
      await lookup(caller, { channel: 'USERNAME', canonical: 'nobody' });

      const rows = await events(t.app());
      expect(rows.map((row) => row.event_type)).toEqual([
        'identity.party.lookup_performed',
        'identity.party.lookup_performed',
      ]);
      expect(rows.map((row) => row.payload.found)).toEqual([true, false]);
      // §S12: nothing recoverable in the outbox.
      expect(JSON.stringify(rows)).not.toContain('janedoe');
    });

    it('records a hidden user as a miss in the velocity event too', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe', discoverableByUsername: false });
      await lookup(caller, { channel: 'USERNAME', canonical: 'janedoe' });
      expect((await events(t.app()))[0]?.payload.found).toBe(false);
    });

    it('refuses a caller below CONTACT_VERIFIED, and says nothing about the target', async () => {
      const caller = await insertUser(t.owner(), { status: 'ACTIVE', verification_level: 'UNVERIFIED' });
      await seedParty({ username: 'janedoe' });

      const real = await lookup(caller, { channel: 'USERNAME', canonical: 'janedoe' }).catch(
        (e: unknown) => e,
      );
      const miss = await lookup(caller, { channel: 'USERNAME', canonical: 'nobody' }).catch(
        (e: unknown) => e,
      );

      expect(real).toBeInstanceOf(ApiError);
      expect((real as ApiError).status).toBe(403);
      expect((miss as ApiError).status).toBe(403);
      expect((real as ApiError).title).toBe((miss as ApiError).title);
      // And nothing was recorded, because nothing was looked up.
      expect(await events(t.app())).toEqual([]);
    });

    it('charges the budget before it reads, so a spent budget never touches a row', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe' });
      const spent = {
        charge: () => Promise.reject(new ApiError(429, 'RATE_LIMITED', 'Too many lookups')),
      };

      await expect(
        lookup(caller, { channel: 'USERNAME', canonical: 'janedoe' }, { budget: spent }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(await events(t.app())).toEqual([]);
    });

    it('calls the enrichment port on a miss as well as a hit', async () => {
      // The §8.3 control 4 rule in its sharpest form: an enrichment that only runs when something
      // was found makes a hit cost one round trip more than a miss, which is the oracle.
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe' });
      const calls: string[][] = [];
      const enrich = (_tx: unknown, ids: readonly string[]) => {
        calls.push([...ids]);
        return Promise.resolve(new Map());
      };

      await lookup(caller, { channel: 'USERNAME', canonical: 'janedoe' }, { enrich });
      await lookup(caller, { channel: 'USERNAME', canonical: 'nobody' }, { enrich });
      expect(calls).toHaveLength(2);
      expect(calls[1]).toEqual([]);
    });
  });

  describe('typeahead (§8.4)', () => {
    const suggest = (actorUserId: string, q: string, overrides: Partial<PartyDeps> = {}) =>
      suggestParties(deps(overrides), { actorUserId, prefix: q });

    it('prefix-matches, never infix', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe' });
      await seedParty({ username: 'bigjane' });

      const { parties } = await suggest(caller, 'jan');
      expect(parties.map((p) => p.username)).toEqual(['janedoe']);
    });

    it('returns nothing below three characters', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe' });
      expect((await suggest(caller, 'ja')).parties).toEqual([]);
    });

    it('returns at most eight', async () => {
      const caller = await seedCaller();
      for (const username of TYPEAHEAD_HANDLES) await seedParty({ username });
      expect((await suggest(caller, 'jan')).parties).toHaveLength(8);
    });

    it('treats a percent sign as a literal, so a wildcard cannot walk the namespace', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe' });
      expect((await suggest(caller, 'ja%')).parties).toEqual([]);
      expect((await suggest(caller, '%%%')).parties).toEqual([]);
    });

    it('starves an unverified account of visibility', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe', verificationLevel: 'UNVERIFIED' });
      expect((await suggest(caller, 'jan')).parties).toEqual([]);
    });

    it('excludes a hidden or non-ACTIVE user', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janehidden', discoverableByUsername: false });
      await seedParty({ username: 'janegone', status: 'CLOSED' });
      expect((await suggest(caller, 'jan')).parties).toEqual([]);
    });

    it('refuses a caller below CONTACT_VERIFIED', async () => {
      const caller = await insertUser(t.owner(), { status: 'ACTIVE', verification_level: 'UNVERIFIED' });
      await expect(suggest(caller, 'jan')).rejects.toBeInstanceOf(ApiError);
    });

    it('charges the USERNAME budget and records the lookup, exactly as an exact lookup does', async () => {
      // §8.3 controls 3 and 6. The typeahead is the username channel's cheapest route to a card, so
      // leaving it outside both would be 43,200 card-returning requests a day that Risk never sees.
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe' });
      const charged: [string, string][] = [];
      const budget = {
        charge: (channel: string, userId: string) => {
          charged.push([channel, userId]);
          return Promise.resolve();
        },
      };

      await suggest(caller, 'jan', { budget });
      expect(charged).toEqual([['USERNAME', caller]]);
      const rows = await events(t.app());
      expect(rows.map((row) => row.event_type)).toEqual(['identity.party.lookup_performed']);
      expect(rows[0]?.payload).toMatchObject({ channel: 'USERNAME', found: true });
      expect(JSON.stringify(rows)).not.toContain('janedoe');
    });

    it('charges and records a prefix too short to search, so the threshold is not a free probe', async () => {
      const caller = await seedCaller();
      const charged: string[] = [];
      const budget = {
        charge: (channel: string) => {
          charged.push(channel);
          return Promise.resolve();
        },
      };

      expect((await suggest(caller, 'ja', { budget })).parties).toEqual([]);
      expect(charged).toEqual(['USERNAME']);
      expect((await events(t.app()))[0]?.payload).toMatchObject({ found: false });
    });

    it('returns PartyCards and nothing else', async () => {
      const caller = await seedCaller();
      await seedParty({ username: 'janedoe', email: 'jane@example.com' });
      const { parties } = await suggest(caller, 'jan');
      expect(Object.keys(parties[0] ?? {}).sort()).toEqual([
        'avatarUrl',
        'badges',
        'canBuy',
        'completedTrades',
        'displayName',
        'isMerchant',
        'memberSince',
        'merchantName',
        'publicId',
        'username',
        'verificationLevel',
      ]);
    });
  });
});
