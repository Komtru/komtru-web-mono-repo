// §10.5's device registry and session list, against a real database. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  fingerprintHint,
  listDevices,
  registerDevice,
  retireDevice,
  trustDevice,
} from '../../../../src/modules/identity/services/device.service.js';
import {
  createSession,
  listSessions,
  revokeSession,
} from '../../../../src/modules/identity/services/session.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  identityInfrastructure,
  seedUser,
  testConfig,
  createTestRedis,
  redisReady,
  testLogger,
} from '../support.js';
import type { Redis } from 'ioredis';

const FINGERPRINT = 'fp-abcdef-123456';

describe.runIf(infraEnabled)('the device registry (M1 §10.5)', () => {
  const t = useTestDatabase();

  it('writes one row per fingerprint and updates it on the next launch', async () => {
    const { userId } = await seedUser(t.app());

    const first = await t.db().transaction((tx) =>
      registerDevice(tx, {
        userId,
        fingerprint: FINGERPRINT,
        platform: 'ANDROID',
        model: 'Pixel 8',
        ip: '203.0.113.7',
      }),
    );
    expect(first.isNewDevice).toBe(true);

    const second = await t
      .db()
      .transaction((tx) =>
        registerDevice(tx, { userId, fingerprint: FINGERPRINT, platform: 'ANDROID', pushToken: 'fcm-1' }),
      );
    expect(second.isNewDevice).toBe(false);
    expect(second.device.id).toBe(first.device.id);
    expect(second.device.hasPushToken).toBe(true);
    // The model it told us the first time survives a launch that does not repeat it.
    expect(second.device.model).toBe('Pixel 8');

    const { rows } = await t.app().query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.devices`);
    expect(rows[0]?.n).toBe(1);
  });

  /** `devices_fingerprint_idx` is deliberately NOT unique: a shared handset is a Risk signal. */
  it('lets two accounts carry the same fingerprint', async () => {
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      await registerDevice(tx, { userId: a.userId, fingerprint: FINGERPRINT });
      await registerDevice(tx, { userId: b.userId, fingerprint: FINGERPRINT });
    });
    const { rows } = await t.app().query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.devices`);
    expect(rows[0]?.n).toBe(2);
  });

  it('lists only the caller’s devices, newest first, and never hands the fingerprint back', async () => {
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      await registerDevice(tx, { userId: a.userId, fingerprint: FINGERPRINT });
      await registerDevice(tx, { userId: b.userId, fingerprint: 'fp-other-999999' });
    });

    const page = await listDevices(t.db(), { userId: a.userId, page: 1, limit: 20 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.fingerprintHint).toBe(fingerprintHint(FINGERPRINT));
    expect(JSON.stringify(page.items)).not.toContain(FINGERPRINT);
  });

  it('retires a device, stops pushing to it, and leaves the row for M13', async () => {
    const { userId } = await seedUser(t.app());
    const { device } = await t
      .db()
      .transaction((tx) => registerDevice(tx, { userId, fingerprint: FINGERPRINT, pushToken: 'fcm-1' }));

    expect(await t.db().transaction((tx) => retireDevice(tx, { userId, deviceId: device.id }))).toBe(true);

    const { rows } = await t
      .app()
      .query<{ status: string; push_token: string | null }>(
        `SELECT status, push_token FROM identity.devices WHERE id = $1`,
        [device.id],
      );
    expect(rows[0]).toEqual({ status: 'RETIRED', push_token: null });
  });

  /** Another user's device id is a MISS, so the controller answers 404 and confirms nothing. */
  it('refuses to retire or trust a device that is not yours', async () => {
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    const { device } = await t
      .db()
      .transaction((tx) => registerDevice(tx, { userId: a.userId, fingerprint: FINGERPRINT }));

    await t.db().transaction(async (tx) => {
      expect(await retireDevice(tx, { userId: b.userId, deviceId: device.id })).toBe(false);
      expect(await trustDevice(tx, { userId: b.userId, deviceId: device.id })).toBe(false);
    });

    const { rows } = await t
      .app()
      .query<{ status: string }>(`SELECT status FROM identity.devices WHERE id = $1`, [device.id]);
    expect(rows[0]?.status).toBe('ACTIVE');
  });

  it('trusts a device the user recognises', async () => {
    const { userId } = await seedUser(t.app());
    const { device } = await t
      .db()
      .transaction((tx) => registerDevice(tx, { userId, fingerprint: FINGERPRINT }));

    expect(await t.db().transaction((tx) => trustDevice(tx, { userId, deviceId: device.id }))).toBe(true);
    const { rows } = await t
      .app()
      .query<{ status: string; trusted: boolean }>(
        `SELECT status, trusted_at IS NOT NULL AS trusted FROM identity.devices WHERE id = $1`,
        [device.id],
      );
    expect(rows[0]).toEqual({ status: 'TRUSTED', trusted: true });
  });

  it('brings a retired device back when the user opens the app on it again', async () => {
    const { userId } = await seedUser(t.app());
    const { device } = await t
      .db()
      .transaction((tx) => registerDevice(tx, { userId, fingerprint: FINGERPRINT }));
    await t.db().transaction((tx) => retireDevice(tx, { userId, deviceId: device.id }));

    const again = await t.db().transaction((tx) => registerDevice(tx, { userId, fingerprint: FINGERPRINT }));
    expect(again.device.status).toBe('ACTIVE');
  });

  it('leaves a BLOCKED device blocked, whatever the app announces', async () => {
    const { userId } = await seedUser(t.app());
    const { device } = await t
      .db()
      .transaction((tx) => registerDevice(tx, { userId, fingerprint: FINGERPRINT }));
    await t.owner().query(`UPDATE identity.devices SET status = 'BLOCKED' WHERE id = $1`, [device.id]);

    const again = await t.db().transaction((tx) => registerDevice(tx, { userId, fingerprint: FINGERPRINT }));
    expect(again.device.status).toBe('BLOCKED');
  });
});

describe.runIf(infraEnabled)(
  'GET /me/sessions and DELETE /me/sessions/{id} (T-031 left these homeless)',
  () => {
    const t = useTestDatabase();
    const config = testConfig();
    let redis: Redis;

    const deps = async () => {
      redis ??= createTestRedis();
      await redisReady(redis);
      return { ...identityInfrastructure(config, redis), logger: testLogger };
    };

    it('lists the live sessions and marks the caller’s own', async () => {
      const { userId } = await seedUser(t.app());
      const d = await deps();
      const [one, two] = await t
        .db()
        .transaction(async (tx) => [
          await createSession(tx, d, { userId, scope: 'CONSUMER', amr: ['pwd'] }),
          await createSession(tx, d, { userId, scope: 'CONSUMER', amr: ['pwd'] }),
        ]);

      const page = await listSessions(t.db(), {
        userId,
        currentSessionId: one.sessionId,
        page: 1,
        limit: 20,
      });
      expect(page.total).toBe(2);
      expect(page.items.filter((s) => s.current).map((s) => s.id)).toEqual([one.sessionId]);
      expect(page.items.map((s) => s.id).sort()).toEqual([one.sessionId, two.sessionId].sort());
    });

    it('omits revoked and consumed rows, so one device is one entry and not a growing chain', async () => {
      const { userId } = await seedUser(t.app());
      const d = await deps();
      const session = await t
        .db()
        .transaction((tx) => createSession(tx, d, { userId, scope: 'CONSUMER', amr: ['pwd'] }));
      await t
        .owner()
        .query(`UPDATE identity.sessions SET consumed_at = now() WHERE id = $1`, [session.sessionId]);

      expect((await listSessions(t.db(), { userId, currentSessionId: null, page: 1, limit: 20 })).total).toBe(
        0,
      );
    });

    it('revokes the whole family behind a session id, not only the named row', async () => {
      const { userId } = await seedUser(t.app());
      const d = await deps();
      const session = await t
        .db()
        .transaction((tx) => createSession(tx, d, { userId, scope: 'CONSUMER', amr: ['pwd'] }));

      expect(
        await t
          .db()
          .transaction((tx) => revokeSession(tx, { userId, sessionId: session.sessionId, reason: 'test' })),
      ).toBe(true);

      const { rows } = await t
        .app()
        .query<{ revoked_at: Date | null; revoke_reason: string | null }>(
          `SELECT revoked_at, revoke_reason FROM identity.sessions WHERE family_id = $1`,
          [session.familyId],
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revoked_at).not.toBeNull();
      expect(rows[0]?.revoke_reason).toBe('test');
    });

    it('refuses to revoke another user’s session', async () => {
      const a = await seedUser(t.app());
      const b = await seedUser(t.app());
      const d = await deps();
      const session = await t
        .db()
        .transaction((tx) => createSession(tx, d, { userId: a.userId, scope: 'CONSUMER', amr: ['pwd'] }));

      expect(
        await t
          .db()
          .transaction((tx) =>
            revokeSession(tx, { userId: b.userId, sessionId: session.sessionId, reason: 'test' }),
          ),
      ).toBe(false);

      const { rows } = await t
        .app()
        .query<{ revoked_at: Date | null }>(`SELECT revoked_at FROM identity.sessions WHERE id = $1`, [
          session.sessionId,
        ]);
      expect(rows[0]?.revoked_at).toBeNull();
    });
  },
);
