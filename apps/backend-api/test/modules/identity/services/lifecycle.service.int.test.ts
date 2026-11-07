// T-039: the status machine, closing, locking and the abandoned-registration sweep, against real
// Postgres. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  closeOwnAccount,
  getAccountNotice,
  lockAccount,
  sweepAbandonedRegistrations,
  type LifecyclePorts,
} from '../../../../src/modules/identity/services/lifecycle.service.js';
import { changeUserStatus } from '../../../../src/modules/identity/services/user.service.js';
import type { StaffActor } from '../../../../src/modules/identity/services/rbac.service.js';
import { ApiError } from '../../../../src/platform/errors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { countingHasher, outboxEventTypes, seedUser, testLogger } from '../support.js';

const noTrades: LifecyclePorts = { hasActiveTrades: () => Promise.resolve(false) };
const openTrade: LifecyclePorts = { hasActiveTrades: () => Promise.resolve(true) };
const PASSWORD = 'correct horse battery';

describe.runIf(infraEnabled)('account lifecycle (T-039)', () => {
  const t = useTestDatabase();

  const staff = async (): Promise<StaffActor> => {
    const { userId } = await seedUser(t.app());
    return { userId, roles: ['SUPER_ADMIN'] };
  };

  const statusOf = async (userId: string) =>
    (
      await t
        .owner()
        .query<{ status: string; closed_at: Date | null; status_reason: string | null }>(
          `SELECT status::text, closed_at, status_reason FROM identity.users WHERE id = $1`,
          [userId],
        )
    ).rows[0];

  const seedSession = async (userId: string) => {
    await t.owner().query(
      `INSERT INTO identity.sessions (user_id, scope, family_id, refresh_token_hash, amr, absolute_expires_at, idle_expires_at)
       VALUES ($1, 'CONSUMER', gen_random_uuid(), sha256(gen_random_uuid()::text::bytea), ARRAY['pwd'], now() + interval '1 day', now() + interval '1 hour')`,
      [userId],
    );
  };

  const liveSessions = async (userId: string): Promise<number> =>
    Number(
      (
        await t
          .owner()
          .query<{ n: string }>(
            `SELECT count(*) AS n FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL`,
            [userId],
          )
      ).rows[0]?.n,
    );

  const withPassword = async (userId: string) => {
    await t
      .owner()
      .query(`INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
        userId,
        `$argon2id$v=19$m=19456,t=2,p=1$test$${PASSWORD}`,
      ]);
  };

  const closeDeps = (ports: LifecyclePorts) => ({
    db: t.db(),
    ports,
    hasher: countingHasher(),
    breach: { enabled: false, logger: testLogger },
    logger: testLogger,
  });

  describe('staff status changes', () => {
    it('suspends: status, kill switch, event and one audit row', async () => {
      const actor = await staff();
      const { userId } = await seedUser(t.app());
      await seedSession(userId);

      const result = await changeUserStatus(
        { db: t.db(), ports: noTrades },
        { actor, userId, to: 'SUSPENDED', reason: 'chargeback ring' },
      );

      expect(result).toEqual({ from: 'ACTIVE', to: 'SUSPENDED' });
      expect((await statusOf(userId))?.status).toBe('SUSPENDED');
      expect(await liveSessions(userId)).toBe(0);
      const { rows } = await t
        .owner()
        .query(
          `SELECT 1 FROM identity.identity_audit_log WHERE subject_user_id = $1 AND action = 'ADMIN_STATUS_CHANGED'`,
          [userId],
        );
      expect(rows).toHaveLength(1);
      expect(await outboxEventTypes(t.owner())).toContain('identity.user.status_changed');
    });

    it('refuses an edge the machine does not have, and leaves the row alone', async () => {
      const actor = await staff();
      const { userId } = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
      await expect(
        changeUserStatus({ db: t.db() }, { actor, userId, to: 'RESTRICTED', reason: 'no' }),
      ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
      expect((await statusOf(userId))?.status).toBe('PENDING_VERIFICATION');
    });

    it('will not let staff lock or anonymise', async () => {
      const actor = await staff();
      const { userId } = await seedUser(t.app());
      for (const to of ['LOCKED', 'ANONYMISED', 'PENDING_VERIFICATION'] as const) {
        await expect(
          changeUserStatus({ db: t.db() }, { actor, userId, to, reason: 'no' }),
        ).rejects.toMatchObject({ status: 400 });
      }
    });

    it('closes a suspended account, but not while a trade is active (CA2)', async () => {
      const actor = await staff();
      const { userId } = await seedUser(t.app(), { status: 'SUSPENDED' });

      await expect(
        changeUserStatus({ db: t.db(), ports: openTrade }, { actor, userId, to: 'CLOSED', reason: 'req' }),
      ).rejects.toMatchObject({ status: 409, extensions: { reason: 'ACTIVE_TRADES' } });
      // No port wired is the same answer: it fails closed.
      await expect(
        changeUserStatus({ db: t.db() }, { actor, userId, to: 'CLOSED', reason: 'req' }),
      ).rejects.toMatchObject({ status: 409, extensions: { reason: 'ACTIVE_TRADES' } });
      expect((await statusOf(userId))?.status).toBe('SUSPENDED');

      await changeUserStatus(
        { db: t.db(), ports: noTrades },
        { actor, userId, to: 'CLOSED', reason: 'documented user request' },
      );
      const row = await statusOf(userId);
      expect(row?.status).toBe('CLOSED');
      expect(row?.closed_at).not.toBeNull();
    });

    it('reinstates a restricted account', async () => {
      const actor = await staff();
      const { userId } = await seedUser(t.app(), { status: 'RESTRICTED' });
      await changeUserStatus({ db: t.db() }, { actor, userId, to: 'ACTIVE', reason: 'cleared' });
      expect((await statusOf(userId))?.status).toBe('ACTIVE');
    });
  });

  describe('lockAccount', () => {
    it('locks an ACTIVE account and kills its sessions; only the system can', async () => {
      const { userId } = await seedUser(t.app());
      await seedSession(userId);
      const result = await lockAccount({ db: t.db() }, { userId, reason: 'rule:velocity', ruleId: 'r1' });
      expect(result).toMatchObject({ from: 'ACTIVE', to: 'LOCKED', sessionsRevoked: 1 });
      expect(await liveSessions(userId)).toBe(0);

      // And a locked account cannot be locked again.
      await expect(lockAccount({ db: t.db() }, { userId, reason: 'again' })).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });
    });
  });

  describe('closeOwnAccount (CA1, CA2)', () => {
    it('refuses while a trade is active, before it touches the password', async () => {
      const { userId } = await seedUser(t.app());
      await withPassword(userId);
      await expect(
        closeOwnAccount(closeDeps(openTrade), { userId, reason: 'leaving', password: 'wrong' }),
      ).rejects.toMatchObject({ status: 409, extensions: { reason: 'ACTIVE_TRADES' } });
      const { rows } = await t
        .owner()
        .query(`SELECT failed_attempts FROM identity.user_credentials WHERE user_id = $1`, [userId]);
      expect(rows[0]).toMatchObject({ failed_attempts: 0 });
    });

    it('a wrong password closes nothing and is counted', async () => {
      const { userId } = await seedUser(t.app());
      await withPassword(userId);
      await expect(
        closeOwnAccount(closeDeps(noTrades), { userId, reason: 'leaving', password: 'nope' }),
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
      expect((await statusOf(userId))?.status).toBe('ACTIVE');
      const { rows } = await t
        .owner()
        .query(`SELECT failed_attempts FROM identity.user_credentials WHERE user_id = $1`, [userId]);
      expect(rows[0]).toMatchObject({ failed_attempts: 1 });
    });

    it('closes with the right password, signs the user out and records the event', async () => {
      const { userId } = await seedUser(t.app());
      await withPassword(userId);
      await seedSession(userId);
      const result = await closeOwnAccount(closeDeps(noTrades), {
        userId,
        reason: 'leaving',
        password: PASSWORD,
      });
      expect(result).toMatchObject({ from: 'ACTIVE', to: 'CLOSED', sessionsRevoked: 1 });
      expect((await statusOf(userId))?.status).toBe('CLOSED');
      expect(await liveSessions(userId)).toBe(0);
      expect(await outboxEventTypes(t.owner())).toContain('identity.user.status_changed');
    });

    it('needs a password when one exists, and a step-up when none does', async () => {
      const a = await seedUser(t.app());
      await withPassword(a.userId);
      await expect(
        closeOwnAccount(closeDeps(noTrades), { userId: a.userId, reason: 'x' }),
      ).rejects.toMatchObject({ status: 422 });

      const b = await seedUser(t.app());
      await expect(
        closeOwnAccount(closeDeps(noTrades), { userId: b.userId, reason: 'x' }),
      ).rejects.toMatchObject({ status: 403, code: 'STEP_UP_REQUIRED' });
      let asked: string | undefined;
      await closeOwnAccount(
        {
          ...closeDeps(noTrades),
          requireStepUp: (_tx, _userId, token) => {
            asked = token;
            return Promise.resolve();
          },
        },
        { userId: b.userId, reason: 'x', stepUpToken: 'tok' },
      );
      expect(asked).toBe('tok');
      expect((await statusOf(b.userId))?.status).toBe('CLOSED');
    });

    it('is refused from a restricted account (deny by default)', async () => {
      const { userId } = await seedUser(t.app(), { status: 'RESTRICTED' });
      await withPassword(userId);
      await expect(
        closeOwnAccount(closeDeps(noTrades), { userId, reason: 'x', password: PASSWORD }),
      ).rejects.toBeInstanceOf(ApiError);
      expect((await statusOf(userId))?.status).toBe('RESTRICTED');
    });
  });

  describe('sweepAbandonedRegistrations', () => {
    it('closes only old, unverified registrations', async () => {
      const old = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
      const verified = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
      const fresh = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
      await t
        .owner()
        .query(
          `UPDATE identity.users SET created_at = now() - interval '31 days' WHERE id = ANY($1::uuid[])`,
          [[old.userId, verified.userId]],
        );
      await t
        .owner()
        .query(
          `INSERT INTO identity.user_emails (user_id, email, email_normal, verified_at) VALUES ($1, 'v@example.com', 'v@example.com', now())`,
          [verified.userId],
        );

      const closed = await sweepAbandonedRegistrations({ db: t.db(), ports: noTrades });

      expect(closed).toBe(1);
      expect((await statusOf(old.userId))?.status).toBe('CLOSED');
      expect((await statusOf(verified.userId))?.status).toBe('PENDING_VERIFICATION');
      expect((await statusOf(fresh.userId))?.status).toBe('PENDING_VERIFICATION');
    });
  });

  describe('getAccountNotice (AS1, AS2, CA1)', () => {
    it('describes a restriction without leaking the staff reason', async () => {
      const { userId, publicId } = await seedUser(t.app(), { status: 'RESTRICTED' });
      await t
        .owner()
        .query(`UPDATE identity.users SET status_reason = 'fraud ring 7' WHERE id = $1`, [userId]);

      const notice = await getAccountNotice(t.db(), noTrades, userId);

      expect(notice).toMatchObject({
        status: 'RESTRICTED',
        noticeKey: 'ACCOUNT_RESTRICTED',
        supportReference: publicId,
        openTrades: false,
        canClose: false,
        abilities: { login: true, buy: false, sell: false },
      });
      expect(JSON.stringify(notice)).not.toContain('fraud ring');
    });

    it('says an active account with an open trade cannot close, and a healthy one has no notice', async () => {
      const { userId } = await seedUser(t.app());
      expect(await getAccountNotice(t.db(), openTrade, userId)).toMatchObject({
        noticeKey: null,
        since: null,
        openTrades: true,
        canClose: false,
      });
      expect(await getAccountNotice(t.db(), noTrades, userId)).toMatchObject({ canClose: true });
    });

    it('reports openTrades as unknown when no port is wired, and then does not offer closing', async () => {
      const { userId } = await seedUser(t.app());
      expect(await getAccountNotice(t.db(), {}, userId)).toMatchObject({ openTrades: null, canClose: false });
    });
  });
});
