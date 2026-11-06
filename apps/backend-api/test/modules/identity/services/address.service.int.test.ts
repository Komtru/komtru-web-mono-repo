// T-042 against the real database: the default-address rules, the location check against the geo
// catalog, the cap, the races, and what the event and audit rows are allowed to say. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { MAX_ADDRESSES_PER_USER, type CreateAddressBody } from '@komtru/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedLocations } from '../../../../src/modules/geo/index.js';
import {
  archiveAddress,
  createAddress,
  hasUsableAddress,
  listAddresses,
  makeDefaultAddress,
  updateAddress,
  type AddressRequestContext,
} from '../../../../src/modules/identity/services/address.service.js';
import { ApiError } from '../../../../src/platform/errors.js';
import { decodeCursor } from '../../../../src/platform/http/paginate.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser } from '../support.js';

const REQUEST: AddressRequestContext = { ip: '203.0.113.7', userAgent: 'vitest', sessionId: null };
const PHONE = '08012345678';
const STREET = '12 Allen Avenue, Opposite Zenith Bank';
const NAME = 'Adaeze Obiora';

describe.runIf(infraEnabled)('saved delivery addresses (T-042)', () => {
  const t = useTestDatabase();
  let lagos: { stateId: string; ikeja: string; apapa: string };
  let oyo: { stateId: string; ibadan: string };

  const lookup = async (code: string): Promise<{ stateId: string; cities: Record<string, string> }> => {
    const { rows } = await t.owner().query<{ state_id: string; name: string; id: string }>(
      `SELECT c.state_id, c.name, c.id FROM geo.cities c JOIN geo.states s ON s.id = c.state_id
        WHERE s.code = $1`,
      [code],
    );
    return {
      stateId: rows[0]?.state_id ?? '',
      cities: Object.fromEntries(rows.map((r) => [r.name, r.id])),
    };
  };

  beforeEach(async () => {
    await seedLocations(t.db());
    const la = await lookup('LA');
    const oy = await lookup('OY');
    lagos = { stateId: la.stateId, ikeja: la.cities.Ikeja ?? '', apapa: la.cities.Apapa ?? '' };
    oyo = { stateId: oy.stateId, ibadan: oy.cities.Ibadan ?? '' };
    expect(lagos.ikeja && lagos.apapa && oyo.ibadan).toBeTruthy();
  });

  const body = (over: Partial<CreateAddressBody> = {}): CreateAddressBody => ({
    label: 'Home',
    recipientName: NAME,
    recipientPhone: PHONE,
    streetLine: STREET,
    landmark: 'Beside the pharmacy',
    stateId: lagos.stateId,
    cityId: lagos.ikeja,
    ...over,
  });
  const create = (userId: string, over: Partial<CreateAddressBody> = {}) =>
    createAddress(t.db(), { userId, body: body(over), request: REQUEST });

  const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error('expected the call to be refused');
  };

  const defaults = async (userId: string): Promise<string[]> => {
    const { rows } = await t
      .owner()
      .query<{ id: string }>(`SELECT id FROM identity.user_addresses WHERE user_id = $1 AND is_default`, [
        userId,
      ]);
    return rows.map((r) => r.id);
  };

  describe('the default address', () => {
    it('makes the first address the default and leaves the second alone', async () => {
      const { userId } = await seedUser(t.app());
      const first = await create(userId);
      const second = await create(userId, { label: 'Shop' });
      expect(first.isDefault).toBe(true);
      expect(second.isDefault).toBe(false);
      expect(await defaults(userId)).toEqual([first.id]);
    });

    it('moves the default when a new address asks for it', async () => {
      const { userId } = await seedUser(t.app());
      const first = await create(userId);
      const second = await create(userId, { label: 'Shop', makeDefault: true });
      expect(second.isDefault).toBe(true);
      expect(await defaults(userId)).toEqual([second.id]);
      const events = await t
        .owner()
        .query<{ payload: { addressId: string; previousAddressId: string | null } }>(
          `SELECT payload FROM platform.outbox WHERE event_type = 'identity.address.default_changed'`,
        );
      expect(events.rows.map((r) => r.payload)).toContainEqual(
        expect.objectContaining({ addressId: second.id, previousAddressId: first.id }),
      );
    });

    it('moves the default with make-default, and keeps it when it is already there', async () => {
      const { userId } = await seedUser(t.app());
      const first = await create(userId);
      const second = await create(userId, { label: 'Shop' });
      expect(
        (await makeDefaultAddress(t.db(), { userId, addressId: second.id, request: REQUEST })).isDefault,
      ).toBe(true);
      expect(await defaults(userId)).toEqual([second.id]);
      await makeDefaultAddress(t.db(), { userId, addressId: second.id, request: REQUEST });
      expect(await defaults(userId)).toEqual([second.id]);
      expect(first.id).not.toBe(second.id);
    });

    it('survives a burst of make-default calls: exactly one default, no errors', async () => {
      const { userId } = await seedUser(t.app());
      const made = [];
      for (let i = 0; i < 6; i += 1) made.push(await create(userId, { label: `A${i}` }));
      const results = await Promise.allSettled(
        made.flatMap((a) => [
          makeDefaultAddress(t.db(), { userId, addressId: a.id, request: REQUEST }),
          makeDefaultAddress(t.db(), { userId, addressId: a.id, request: REQUEST }),
        ]),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      expect(await defaults(userId)).toHaveLength(1);
    });

    it('promotes the newest remaining address when the default is archived', async () => {
      const { userId } = await seedUser(t.app());
      const first = await create(userId, { label: 'One' });
      await create(userId, { label: 'Two' });
      const third = await create(userId, { label: 'Three' });
      const archived = await archiveAddress(t.db(), { userId, addressId: first.id, request: REQUEST });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.isDefault).toBe(false);
      expect(await defaults(userId)).toEqual([third.id]);
    });

    it('leaves no default when the last address is archived, and the next one takes it', async () => {
      const { userId } = await seedUser(t.app());
      const only = await create(userId);
      await archiveAddress(t.db(), { userId, addressId: only.id, request: REQUEST });
      expect(await defaults(userId)).toEqual([]);
      const next = await create(userId, { label: 'New' });
      expect(next.isDefault).toBe(true);
    });
  });

  describe('where the address is', () => {
    it('refuses a city that is not in the chosen state, with a cityId field error', async () => {
      const { userId } = await seedUser(t.app());
      const error = await failure(create(userId, { cityId: oyo.ibadan }));
      expect(error.status).toBe(422);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.fieldErrors?.map((f) => f.path)).toEqual(['cityId']);
    });

    it('refuses a city or a state that does not exist', async () => {
      const { userId } = await seedUser(t.app());
      const ghost = '0190b0a0-0000-7000-8000-00000000dead';
      expect((await failure(create(userId, { cityId: ghost }))).status).toBe(422);
      expect((await failure(create(userId, { stateId: ghost }))).status).toBe(422);
    });

    it('refuses a deactivated city', async () => {
      const { userId } = await seedUser(t.app());
      await t.owner().query(`UPDATE geo.cities SET active = false WHERE id = $1`, [lagos.apapa]);
      expect((await failure(create(userId, { cityId: lagos.apapa }))).status).toBe(422);
    });

    it('checks the pair again when an edit moves either half, against the stored half', async () => {
      const { userId } = await seedUser(t.app());
      const address = await create(userId);
      const moveState = updateAddress(t.db(), {
        userId,
        addressId: address.id,
        body: { stateId: oyo.stateId },
        request: REQUEST,
      });
      expect((await failure(moveState)).status).toBe(422);
      const moved = await updateAddress(t.db(), {
        userId,
        addressId: address.id,
        body: { stateId: oyo.stateId, cityId: oyo.ibadan },
        request: REQUEST,
      });
      expect(moved.cityId).toBe(oyo.ibadan);
      expect(moved.stateName).toBe('Oyo');
    });

    it('lets an unrelated edit through after the city was deactivated, and flags the city', async () => {
      const { userId } = await seedUser(t.app());
      const address = await create(userId);
      await t.owner().query(`UPDATE geo.cities SET active = false WHERE id = $1`, [lagos.ikeja]);
      const renamed = await updateAddress(t.db(), {
        userId,
        addressId: address.id,
        body: { label: 'Mum’s place' },
        request: REQUEST,
      });
      expect(renamed.label).toBe('Mum’s place');
      expect(renamed.cityActive).toBe(false);
    });
  });

  describe('the fields', () => {
    it('stores the phone as E.164 and returns it that way', async () => {
      const { userId } = await seedUser(t.app());
      const address = await create(userId, { recipientPhone: '0801 234 5678' });
      expect(address.recipientPhone).toBe('+2348012345678');
    });

    it('refuses a phone number it cannot parse, on create and on edit', async () => {
      const { userId } = await seedUser(t.app());
      const bad = await failure(create(userId, { recipientPhone: '12345' }));
      expect(bad.status).toBe(422);
      expect(bad.fieldErrors?.map((f) => f.path)).toEqual(['recipientPhone']);
      const address = await create(userId);
      const edit = updateAddress(t.db(), {
        userId,
        addressId: address.id,
        body: { recipientPhone: 'call me' },
        request: REQUEST,
      });
      expect((await failure(edit)).status).toBe(422);
    });

    it('clears a landmark with null and leaves it alone when the edit does not mention it', async () => {
      const { userId } = await seedUser(t.app());
      const address = await create(userId);
      const kept = await updateAddress(t.db(), {
        userId,
        addressId: address.id,
        body: { label: 'Home 2' },
        request: REQUEST,
      });
      expect(kept.landmark).toBe('Beside the pharmacy');
      const cleared = await updateAddress(t.db(), {
        userId,
        addressId: address.id,
        body: { landmark: null },
        request: REQUEST,
      });
      expect(cleared.landmark).toBeNull();
    });
  });

  describe('the cap', () => {
    it(`holds a user to ${MAX_ADDRESSES_PER_USER} live addresses, and archived ones do not count`, async () => {
      const { userId } = await seedUser(t.app());
      const made = [];
      for (let i = 0; i < MAX_ADDRESSES_PER_USER; i += 1) made.push(await create(userId, { label: `A${i}` }));
      const over = await failure(create(userId, { label: 'one too many' }));
      expect(over.status).toBe(409);
      expect(over.code).toBe('ADDRESS_LIMIT_REACHED');

      const last = made.at(-1);
      if (!last) throw new Error('no address');
      await archiveAddress(t.db(), { userId, addressId: last.id, request: REQUEST });
      await create(userId, { label: 'room again' });
    });

    it('cannot be beaten by a burst of creates', async () => {
      const { userId } = await seedUser(t.app());
      const results = await Promise.allSettled(
        Array.from({ length: MAX_ADDRESSES_PER_USER + 5 }, (_unused, i) =>
          create(userId, { label: `B${i}` }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_ADDRESSES_PER_USER);
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(
        refused.every((r) => r.reason instanceof ApiError && r.reason.code === 'ADDRESS_LIMIT_REACHED'),
      ).toBe(true);
      const { rows } = await t
        .owner()
        .query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.user_addresses WHERE user_id = $1`, [
          userId,
        ]);
      expect(rows[0]?.n).toBe(MAX_ADDRESSES_PER_USER);
      expect(await defaults(userId)).toHaveLength(1);
    });

    it('counts per user', async () => {
      const a = await seedUser(t.app());
      const b = await seedUser(t.app());
      for (let i = 0; i < MAX_ADDRESSES_PER_USER; i += 1) await create(a.userId, { label: `A${i}` });
      await create(b.userId);
    });
  });

  describe('archiving', () => {
    it('keeps the row, hides it from the list, and is idempotent', async () => {
      const { userId } = await seedUser(t.app());
      const keep = await create(userId, { label: 'Keep' });
      const drop = await create(userId, { label: 'Drop' });
      const first = await archiveAddress(t.db(), { userId, addressId: drop.id, request: REQUEST });
      const again = await archiveAddress(t.db(), { userId, addressId: drop.id, request: REQUEST });
      expect(again.archivedAt).toBe(first.archivedAt);

      const { rows } = await t
        .owner()
        .query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.user_addresses WHERE user_id = $1`, [
          userId,
        ]);
      expect(rows[0]?.n).toBe(2);
      const page = await listAddresses(t.db(), { userId, limit: 20 });
      expect(page.items.map((a) => a.id)).toEqual([keep.id]);

      const archivedEvents = await t
        .owner()
        .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.address.archived'`);
      expect(archivedEvents.rowCount).toBe(1);
    });

    it('refuses to edit or default an archived address', async () => {
      const { userId } = await seedUser(t.app());
      await create(userId, { label: 'Stay' });
      const gone = await create(userId, { label: 'Gone' });
      await archiveAddress(t.db(), { userId, addressId: gone.id, request: REQUEST });
      const edit = await failure(
        updateAddress(t.db(), { userId, addressId: gone.id, body: { label: 'Back' }, request: REQUEST }),
      );
      expect(edit.status).toBe(409);
      const dflt = await failure(
        makeDefaultAddress(t.db(), { userId, addressId: gone.id, request: REQUEST }),
      );
      expect(dflt.status).toBe(409);
    });
  });

  describe("another user's address", () => {
    it('is a 404 for every call, never a 403', async () => {
      const owner = await seedUser(t.app());
      const stranger = await seedUser(t.app());
      const address = await create(owner.userId);
      const as = { userId: stranger.userId, addressId: address.id, request: REQUEST };
      expect((await failure(updateAddress(t.db(), { ...as, body: { label: 'Mine' } }))).status).toBe(404);
      expect((await failure(archiveAddress(t.db(), as))).status).toBe(404);
      expect((await failure(makeDefaultAddress(t.db(), as))).status).toBe(404);
      expect((await failure(archiveAddress(t.db(), { ...as, addressId: crypto.randomUUID() }))).status).toBe(
        404,
      );
    });
  });

  describe('listing', () => {
    it('puts the default first, then newest first, and pages with a cursor to the end', async () => {
      const { userId } = await seedUser(t.app());
      const made = [];
      for (let i = 0; i < 5; i += 1) made.push(await create(userId, { label: `A${i}` }));
      // A0 is the default; the rest are newest-first behind it.
      const expected = [made[0], made[4], made[3], made[2], made[1]].map((a) => a?.id);

      const seen: string[] = [];
      let cursor: ReturnType<typeof decodeCursor> | undefined;
      let pages = 0;
      for (;;) {
        const page = await listAddresses(t.db(), { userId, limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.items.map((a) => a.id));
        pages += 1;
        if (!page.nextCursor) break;
        cursor = decodeCursor(page.nextCursor);
      }
      expect(pages).toBe(3);
      expect(seen).toEqual(expected);
    });

    it('lists only the caller’s own addresses and names the city and state', async () => {
      const a = await seedUser(t.app());
      const b = await seedUser(t.app());
      await create(a.userId);
      await create(b.userId, { stateId: oyo.stateId, cityId: oyo.ibadan });
      const page = await listAddresses(t.db(), { userId: a.userId, limit: 20 });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ cityName: 'Ikeja', stateName: 'Lagos', cityActive: true });
    });

    it('turns a cursor that is not this list’s into a 422', async () => {
      const { userId } = await seedUser(t.app());
      const bad = await failure(listAddresses(t.db(), { userId, limit: 20, cursor: { n: 'x', id: 'y' } }));
      expect(bad.status).toBe(422);
    });
  });

  describe('hasUsableAddress', () => {
    it('is false with no address, true with a live one in an active city', async () => {
      const { userId } = await seedUser(t.app());
      expect(await hasUsableAddress(t.db(), userId)).toBe(false);
      await create(userId);
      expect(await hasUsableAddress(t.db(), userId)).toBe(true);
    });

    it('is false once the only address is archived', async () => {
      const { userId } = await seedUser(t.app());
      const only = await create(userId);
      await archiveAddress(t.db(), { userId, addressId: only.id, request: REQUEST });
      expect(await hasUsableAddress(t.db(), userId)).toBe(false);
    });

    it('is false when every live address is in a deactivated city, true if one is not', async () => {
      const { userId } = await seedUser(t.app());
      await create(userId);
      await t.owner().query(`UPDATE geo.cities SET active = false WHERE id = $1`, [lagos.ikeja]);
      expect(await hasUsableAddress(t.db(), userId)).toBe(false);
      await create(userId, { label: 'Ibadan', stateId: oyo.stateId, cityId: oyo.ibadan });
      expect(await hasUsableAddress(t.db(), userId)).toBe(true);
    });

    it('is about this user only', async () => {
      const a = await seedUser(t.app());
      const b = await seedUser(t.app());
      await create(a.userId);
      expect(await hasUsableAddress(t.db(), b.userId)).toBe(false);
    });
  });

  describe('what the event and audit rows say', () => {
    it('carries ids and field names, never the phone, the street, the name or the landmark', async () => {
      const { userId } = await seedUser(t.app());
      const address = await create(userId);
      await updateAddress(t.db(), {
        userId,
        addressId: address.id,
        body: { streetLine: '99 Secret Close', recipientPhone: '08099999999' },
        request: REQUEST,
      });
      const second = await create(userId, { label: 'Shop' });
      await makeDefaultAddress(t.db(), { userId, addressId: second.id, request: REQUEST });
      await archiveAddress(t.db(), { userId, addressId: address.id, request: REQUEST });

      const outbox = await t
        .owner()
        .query<{ event_type: string; payload: unknown; actor: unknown }>(
          `SELECT event_type, payload, actor FROM platform.outbox WHERE event_type LIKE 'identity.address.%'`,
        );
      const audit = await t
        .owner()
        .query<{ action: string; metadata: unknown }>(
          `SELECT action, metadata FROM identity.identity_audit_log WHERE action LIKE 'ADDRESS_%'`,
        );
      expect(new Set(outbox.rows.map((r) => r.event_type))).toEqual(
        new Set([
          'identity.address.added',
          'identity.address.updated',
          'identity.address.archived',
          'identity.address.default_changed',
        ]),
      );
      expect(new Set(audit.rows.map((r) => r.action))).toEqual(
        new Set(['ADDRESS_ADDED', 'ADDRESS_UPDATED', 'ADDRESS_ARCHIVED', 'ADDRESS_DEFAULT_SET']),
      );

      const everything = JSON.stringify([outbox.rows, audit.rows]);
      for (const pii of [
        STREET,
        '99 Secret Close',
        NAME,
        PHONE,
        '08099999999',
        '8012345678',
        '8099999999',
        'Beside the pharmacy',
      ]) {
        expect(everything).not.toContain(pii);
      }
      const updated = outbox.rows.find((r) => r.event_type === 'identity.address.updated');
      expect((updated?.payload as { changed: string[] }).changed.sort()).toEqual([
        'recipientPhone',
        'streetLine',
      ]);
    });

    it('publishes nothing when the call is refused', async () => {
      const { userId } = await seedUser(t.app());
      await failure(create(userId, { cityId: oyo.ibadan }));
      const outbox = await t
        .owner()
        .query(`SELECT 1 FROM platform.outbox WHERE event_type LIKE 'identity.address.%'`);
      expect(outbox.rowCount).toBe(0);
    });
  });
});
