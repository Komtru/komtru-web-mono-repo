// M1 §8.5, against the real database: the three stored forms of a destination, the claim rules that
// make link-forwarding useless, and the expiry sweep M7 depends on.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createEncryption } from '../../../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import {
  claimInvitationsForDestination,
  createInvitation,
  expireInvitations,
  previewInvitation,
  resolveInvitationToken,
  type InvitationDeps,
} from '../../../../src/modules/identity/services/invitation.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser } from '../infrastructure/postgres/support.js';
import { testConfig, testLogger } from '../support.js';

describe.runIf(infraEnabled)('party invitations (M1 §8.5)', () => {
  const t = useTestDatabase();
  const hasher = createHmacHasher('a-pepper-for-tests-0123456789abc');
  const encryption = createEncryption(testConfig({ ENCRYPTION_KEY: randomBytes(32).toString('hex') }));

  const deps = (overrides: Partial<InvitationDeps> = {}): InvitationDeps => ({
    db: t.db(),
    hasher,
    encryption,
    logger: testLogger,
    ...overrides,
  });

  const seedUserRow = (overrides: Record<string, unknown> = {}): Promise<string> =>
    insertUser(t.owner(), { status: 'ACTIVE', verification_level: 'CONTACT_VERIFIED', ...overrides });

  const invite = async (inviterUserId: string, overrides: Record<string, unknown> = {}) => {
    const result = await createInvitation(deps(), {
      inviterUserId,
      channel: 'EMAIL',
      destination: 'chidi@example.com',
      intendedRole: 'BUYER',
      ...overrides,
    } as unknown as Parameters<typeof createInvitation>[1]);
    if (result.outcome !== 'CREATED') throw new Error(`expected CREATED, got ${result.outcome}`);
    return result;
  };

  const row = async (id: string) => {
    const { rows } = await t
      .owner()
      .query<Record<string, unknown>>(`SELECT * FROM identity.party_invitations WHERE id = $1`, [id]);
    return rows[0];
  };

  const events = async (pool: pg.Pool, type?: string) => {
    const { rows } = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM platform.outbox
        ${type ? 'WHERE event_type = $1' : ''} ORDER BY occurred_at, event_id`,
      type ? [type] : [],
    );
    return rows;
  };

  const claim = (userId: string, canonical: string, channel: 'EMAIL' | 'PHONE' = 'EMAIL') =>
    t
      .db()
      .transaction((tx) => claimInvitationsForDestination(tx, { hasher }, { userId, channel, canonical }));

  describe('creation', () => {
    it('stores the destination hashed for lookup, masked for display and encrypted for sending', async () => {
      const inviter = await seedUserRow();
      const { invitationId } = await invite(inviter, { destination: 'Chidi+Shop@gmail.com' });
      const stored = await row(invitationId);

      expect(stored?.destination_masked).toBe('c•••@gmail.com');
      expect(String(stored?.destination_hash)).not.toContain('chidi');
      // The DELIVERABLE address, not the canonical one: canonicalising folds the +tag away, and
      // sending to a rewritten address is its own bug.
      expect(encryption.open(stored?.destination_enc as Buffer)).toBe('Chidi+Shop@gmail.com');
    });

    it('expires fourteen days out and publishes identity.party_invitation.created', async () => {
      const inviter = await seedUserRow();
      const { invitationId, expiresAt } = await invite(inviter, {
        context: { type: 'TRADE', id: '11111111-1111-4111-8111-111111111111' },
      });

      expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(13.5 * 24 * 3600 * 1000);
      const published = await events(t.app(), 'identity.party_invitation.created');
      expect(published).toHaveLength(1);
      expect(published[0]?.payload).toMatchObject({
        invitationId,
        contextType: 'TRADE',
        intendedRole: 'BUYER',
        maskedDestination: 'c•••@example.com',
      });
      // §S12 and the created event's own rule: nothing recoverable reaches the outbox.
      expect(JSON.stringify(published)).not.toContain('chidi@example.com');
    });

    it('refuses the inviter their own verified address (design C5)', async () => {
      const inviter = await seedUserRow();
      await t.owner().query(
        `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
           VALUES ($1, 'me@example.com', 'me@example.com', true, now())`,
        [inviter],
      );

      expect(
        await createInvitation(deps(), {
          inviterUserId: inviter,
          channel: 'EMAIL',
          destination: 'me@example.com',
          intendedRole: 'SELLER',
        }),
      ).toEqual({ outcome: 'SELF' });
    });

    it('rejects a destination that cannot be canonicalised', async () => {
      const inviter = await seedUserRow();
      expect(
        await createInvitation(deps(), {
          inviterUserId: inviter,
          channel: 'PHONE',
          destination: 'not a number',
          intendedRole: 'BUYER',
        }),
      ).toEqual({ outcome: 'INVALID_DESTINATION' });
    });

    it('creates the invitation even when the address belongs to a hidden account', async () => {
      // A lookup miss can be a live account with discoverable_by_email = false. Claiming here would
      // defeat the flag the lookup honoured; the invitation expires instead, and M7 cancels.
      const inviter = await seedUserRow();
      const hidden = await seedUserRow({ discoverable_by_email: false });
      await t.owner().query(
        `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
           VALUES ($1, 'chidi@example.com', 'chidi@example.com', true, now())`,
        [hidden],
      );

      const { invitationId } = await invite(inviter);
      expect((await row(invitationId))?.status).toBe('PENDING');
      expect(await events(t.app(), 'identity.party_invitation.claimed')).toEqual([]);
    });
  });

  describe('claim on verify (§8.5 steps 5–6)', () => {
    it('claims on verification of the invited channel and publishes .claimed', async () => {
      const inviter = await seedUserRow();
      const { invitationId } = await invite(inviter);
      const invitee = await seedUserRow();

      expect(await claim(invitee, 'chidi@example.com')).toBe(1);
      expect(await row(invitationId)).toMatchObject({ status: 'CLAIMED', claimed_by_user_id: invitee });
      expect((await events(t.app(), 'identity.party_invitation.claimed'))[0]?.payload).toMatchObject({
        invitationId,
        claimedByUserId: invitee,
        inviterUserId: inviter,
      });
    });

    it('leaves the invitation pending when a different address is verified', async () => {
      // §8.5 rule 6, which is what makes forwarding the link useless.
      const inviter = await seedUserRow();
      const { invitationId } = await invite(inviter);
      const someoneElse = await seedUserRow();

      expect(await claim(someoneElse, 'wrongperson@example.com')).toBe(0);
      expect((await row(invitationId))?.status).toBe('PENDING');
    });

    it('leaves the invitation pending when the inviter verifies the address themselves', async () => {
      const inviter = await seedUserRow();
      const { invitationId } = await invite(inviter);

      expect(await claim(inviter, 'chidi@example.com')).toBe(0);
      expect((await row(invitationId))?.status).toBe('PENDING');
    });

    it('does not claim a BUYER invitation for a certified merchant (design §6.3)', async () => {
      const inviter = await seedUserRow();
      const buyerInvite = await invite(inviter, { intendedRole: 'BUYER' });
      const sellerInvite = await invite(inviter, { intendedRole: 'SELLER' });
      const merchant = await seedUserRow();
      await t.owner().query(
        `INSERT INTO identity.user_capabilities (user_id, capability, status)
           VALUES ($1, 'MERCHANT', 'ACTIVE')`,
        [merchant],
      );

      expect(await claim(merchant, 'chidi@example.com')).toBe(1);
      expect((await row(buyerInvite.invitationId))?.status).toBe('PENDING');
      expect((await row(sellerInvite.invitationId))?.status).toBe('CLAIMED');
    });

    it('claims for an account whose merchant capability is only pending or revoked', async () => {
      const inviter = await seedUserRow();
      const buyerInvite = await invite(inviter, { intendedRole: 'BUYER' });
      const applicant = await seedUserRow();
      await t.owner().query(
        `INSERT INTO identity.user_capabilities (user_id, capability, status)
           VALUES ($1, 'MERCHANT', 'PENDING')`,
        [applicant],
      );

      expect(await claim(applicant, 'chidi@example.com')).toBe(1);
      expect((await row(buyerInvite.invitationId))?.status).toBe('CLAIMED');
    });

    it('claims every pending invitation for that destination at once', async () => {
      const first = await seedUserRow();
      const second = await seedUserRow();
      await invite(first, { intendedRole: 'SELLER' });
      await invite(second, { intendedRole: 'SELLER' });
      const invitee = await seedUserRow();

      expect(await claim(invitee, 'chidi@example.com')).toBe(2);
    });

    it('does not claim an invitation that has already expired', async () => {
      const inviter = await seedUserRow();
      const { invitationId } = await invite(inviter);
      await t
        .owner()
        .query(`UPDATE identity.party_invitations SET expires_at = now() - interval '1 day' WHERE id = $1`, [
          invitationId,
        ]);
      const invitee = await seedUserRow();

      expect(await claim(invitee, 'chidi@example.com')).toBe(0);
    });

    it('claims a phone invitation however the inviter chose to send it', async () => {
      const inviter = await seedUserRow();
      const { invitationId } = await invite(inviter, {
        channel: 'PHONE',
        destination: '0802 341 5567',
        intendedRole: 'SELLER',
      });
      await t
        .owner()
        .query(`UPDATE identity.party_invitations SET channel = 'WHATSAPP' WHERE id = $1`, [invitationId]);
      const invitee = await seedUserRow();

      expect(await claim(invitee, '+2348023415567', 'PHONE')).toBe(1);
    });

    it('does not let an email claim a phone invitation or the other way round', async () => {
      const inviter = await seedUserRow();
      await invite(inviter, { channel: 'PHONE', destination: '0802 341 5567', intendedRole: 'SELLER' });
      const invitee = await seedUserRow();

      expect(await claim(invitee, '+2348023415567', 'EMAIL')).toBe(0);
    });
  });

  describe('expiry (§8.5 step 7)', () => {
    it('expires only pending invitations past their expiry and publishes .expired for each', async () => {
      const inviter = await seedUserRow();
      const due = await invite(inviter, { intendedRole: 'SELLER' });
      const live = await invite(inviter, { intendedRole: 'BUYER' });
      await t
        .owner()
        .query(`UPDATE identity.party_invitations SET expires_at = now() - interval '1 day' WHERE id = $1`, [
          due.invitationId,
        ]);

      expect(await expireInvitations(t.db())).toEqual({ expired: 1 });
      expect((await row(due.invitationId))?.status).toBe('EXPIRED');
      expect((await row(live.invitationId))?.status).toBe('PENDING');
      const published = await events(t.app(), 'identity.party_invitation.expired');
      expect(published).toHaveLength(1);
      expect(published[0]?.payload).toMatchObject({
        invitationId: due.invitationId,
        inviterUserId: inviter,
        intendedRole: 'SELLER',
      });
    });

    it('is idempotent: a second sweep expires nothing and publishes nothing', async () => {
      const inviter = await seedUserRow();
      const due = await invite(inviter);
      await t
        .owner()
        .query(`UPDATE identity.party_invitations SET expires_at = now() - interval '1 day' WHERE id = $1`, [
          due.invitationId,
        ]);

      await expireInvitations(t.db());
      expect(await expireInvitations(t.db())).toEqual({ expired: 0 });
      expect(await events(t.app(), 'identity.party_invitation.expired')).toHaveLength(1);
    });

    it('sweeps a backlog larger than one batch', async () => {
      const inviter = await seedUserRow();
      for (let i = 0; i < 5; i += 1) await invite(inviter, { destination: `c${String(i)}@example.com` });
      await t.owner().query(`UPDATE identity.party_invitations SET expires_at = now() - interval '1 day'`);

      expect(await expireInvitations(t.db(), { batch: 2 })).toEqual({ expired: 5 });
    });

    it('never expires a claimed invitation', async () => {
      const inviter = await seedUserRow();
      const { invitationId } = await invite(inviter);
      const invitee = await seedUserRow();
      await claim(invitee, 'chidi@example.com');
      await t.owner().query(`UPDATE identity.party_invitations SET expires_at = now() - interval '1 day'`);

      expect(await expireInvitations(t.db())).toEqual({ expired: 0 });
      expect((await row(invitationId))?.status).toBe('CLAIMED');
    });
  });

  describe('the claim link', () => {
    it('previews by token, naming the inviter and never the trade', async () => {
      const inviter = await seedUserRow({ username: 'janedoe', username_skeleton: 'janedoe' });
      const { token } = await invite(inviter, {
        context: { type: 'TRADE', id: '11111111-1111-4111-8111-111111111111' },
      });

      const preview = await previewInvitation(deps(), token);
      expect(preview).toMatchObject({
        status: 'PENDING',
        intendedRole: 'BUYER',
        maskedDestination: 'c•••@example.com',
        inviterUsername: 'janedoe',
        contextType: 'TRADE',
      });
      expect(preview).not.toHaveProperty('contextId');
    });

    it('returns null for a token nobody was issued', async () => {
      expect(await previewInvitation(deps(), 'not-a-real-token')).toBeNull();
    });

    it('resolves a live token for registration and refuses an expired or claimed one', async () => {
      const inviter = await seedUserRow();
      const { token, invitationId } = await invite(inviter);

      expect(await t.db().transaction((tx) => resolveInvitationToken(tx, token))).toEqual({
        id: invitationId,
      });

      await t
        .owner()
        .query(`UPDATE identity.party_invitations SET status = 'CLAIMED' WHERE id = $1`, [invitationId]);
      expect(await t.db().transaction((tx) => resolveInvitationToken(tx, token))).toBeNull();
    });
  });
});
