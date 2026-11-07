/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- raw `pg` rows and supertest bodies are untyped in assertions */
// T-039: account recovery against real Postgres. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import {
  decideRecovery,
  expireRecoveryRequests,
  listRecoveryRequests,
  requestRecovery,
  type RecoveryDeps,
} from '../../../../src/modules/identity/services/recovery.service.js';
import type { StaffActor } from '../../../../src/modules/identity/services/rbac.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { outboxEventTypes, seedUser } from '../support.js';

describe.runIf(infraEnabled)('account recovery (T-039)', () => {
  const t = useTestDatabase();
  const deps = (): RecoveryDeps => ({
    db: t.db(),
    identifierHasher: createHmacHasher('pepper-for-tests-0123456789abcdef'),
  });

  const staff = async (roles = ['OPERATIONS_ADMIN']): Promise<StaffActor> => ({
    userId: (await seedUser(t.app())).userId,
    roles,
  });

  const withEmail = async (status = 'ACTIVE') => {
    const { userId } = await seedUser(t.app(), { status });
    const email = `user-${userId.slice(0, 8)}@example.com`;
    await t
      .owner()
      .query(
        `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at) VALUES ($1, $2, $2, true, now())`,
        [userId, email],
      );
    return { userId, email };
  };

  const seedSession = (userId: string) =>
    t.owner().query(
      `INSERT INTO identity.sessions (user_id, scope, family_id, refresh_token_hash, amr, absolute_expires_at, idle_expires_at)
       VALUES ($1, 'CONSUMER', gen_random_uuid(), sha256(gen_random_uuid()::text::bytea), ARRAY['pwd'], now() + interval '1 day', now() + interval '1 hour')`,
      [userId],
    );

  const requestRow = async (id: string) =>
    (await t.owner().query(`SELECT * FROM identity.account_recovery_requests WHERE id = $1`, [id])).rows[0];

  describe('requestRecovery', () => {
    it('opens a human-review request for a known account and emits the ticket event', async () => {
      const { userId, email } = await withEmail();
      const receipt = await requestRecovery(deps(), { identifier: email, method: 'LOST_PHONE' });

      const row = await requestRow(receipt.requestId);
      expect(row).toMatchObject({
        user_id: userId,
        method: 'LOST_PHONE',
        status: 'PENDING',
        requires_human: true,
      });
      expect(row.risk_score).toBeGreaterThan(0);
      expect(await outboxEventTypes(t.owner())).toContain('identity.account.recovery_requested');
      // The claimed identifier is a digest, never the address.
      expect(Buffer.from(row.claimed_identifier_hash).toString('utf8')).not.toContain('example.com');
    });

    it('answers an unknown identifier identically, stores it, and opens no ticket', async () => {
      const { email } = await withEmail();
      const known = await requestRecovery(deps(), { identifier: email, method: 'LOST_ALL' });
      const unknown = await requestRecovery(deps(), { identifier: 'nobody@example.com', method: 'LOST_ALL' });

      expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
      expect(unknown.status).toBe(known.status);
      const row = await requestRow(unknown.requestId);
      expect(row).toMatchObject({ user_id: null, status: 'REJECTED', decision_reason: 'NO_SUCH_ACCOUNT' });
      expect(
        (await outboxEventTypes(t.owner())).filter((e) => e === 'identity.account.recovery_requested'),
      ).toHaveLength(1);
    });

    it('returns the open request instead of opening a second ticket', async () => {
      const { email } = await withEmail();
      const first = await requestRecovery(deps(), { identifier: email, method: 'LOST_PHONE' });
      const second = await requestRecovery(deps(), { identifier: email, method: 'LOST_ALL' });
      expect(second.requestId).toBe(first.requestId);
      expect(
        (await outboxEventTypes(t.owner())).filter((e) => e === 'identity.account.recovery_requested'),
      ).toHaveLength(1);
    });

    it('with a raised threshold, a low-risk request waits for the OTP flow instead of a reviewer', async () => {
      const { email } = await withEmail();
      const receipt = await requestRecovery(
        { ...deps(), reviewThreshold: 90 },
        { identifier: email, method: 'LOST_PASSWORD' },
      );
      expect(await requestRow(receipt.requestId)).toMatchObject({
        status: 'CHALLENGED',
        requires_human: false,
      });
    });
  });

  describe('decideRecovery', () => {
    it('approval unlocks a LOCKED account, signs it out everywhere and announces the outcome', async () => {
      const { userId, email } = await withEmail('LOCKED');
      await seedSession(userId);
      const receipt = await requestRecovery(deps(), { identifier: email, method: 'MFA_LOCKOUT' });
      const actor = await staff();

      const result = await decideRecovery(deps(), {
        actor,
        requestId: receipt.requestId,
        decision: 'APPROVE',
        reason: 'verified by video call',
      });

      expect(result).toEqual({ status: 'COMPLETED', unlocked: true });
      expect(
        (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status: 'ACTIVE' });
      expect(
        (
          await t
            .owner()
            .query(
              `SELECT count(*)::int n FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL`,
              [userId],
            )
        ).rows[0].n,
      ).toBe(0);
      expect(await requestRow(receipt.requestId)).toMatchObject({
        status: 'COMPLETED',
        reviewed_by: actor.userId,
      });
      const events = await outboxEventTypes(t.owner());
      expect(events).toContain('identity.account.recovery_completed');
      expect(events).toContain('identity.user.status_changed');
    });

    it('rejection changes nothing about the account', async () => {
      const { userId, email } = await withEmail('LOCKED');
      const receipt = await requestRecovery(deps(), { identifier: email, method: 'LOST_ALL' });
      const result = await decideRecovery(deps(), {
        actor: await staff(),
        requestId: receipt.requestId,
        decision: 'REJECT',
        reason: 'could not verify',
      });
      expect(result).toEqual({ status: 'REJECTED', unlocked: false });
      expect(
        (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status: 'LOCKED' });
    });

    it('will not restore a suspended account, and will not decide twice', async () => {
      const { email } = await withEmail('SUSPENDED');
      const receipt = await requestRecovery(deps(), { identifier: email, method: 'LOST_ALL' });
      const actor = await staff();
      await expect(
        decideRecovery(deps(), { actor, requestId: receipt.requestId, decision: 'APPROVE', reason: 'ok' }),
      ).rejects.toMatchObject({ status: 409 });
      await decideRecovery(deps(), {
        actor,
        requestId: receipt.requestId,
        decision: 'REJECT',
        reason: 'suspended',
      });
      await expect(
        decideRecovery(deps(), { actor, requestId: receipt.requestId, decision: 'REJECT', reason: 'again' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('is closed to a reviewer without the permission and to the subject themself', async () => {
      const { userId, email } = await withEmail('LOCKED');
      const receipt = await requestRecovery(deps(), { identifier: email, method: 'LOST_ALL' });

      await expect(
        decideRecovery(deps(), {
          actor: await staff(['SUPPORT_AGENT']),
          requestId: receipt.requestId,
          decision: 'APPROVE',
          reason: 'x',
        }),
      ).rejects.toMatchObject({ status: 403 });
      // The subject, even holding a role that would otherwise allow it.
      await expect(
        decideRecovery(deps(), {
          actor: { userId, roles: ['OPERATIONS_ADMIN'] },
          requestId: receipt.requestId,
          decision: 'APPROVE',
          reason: 'x',
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status: 'LOCKED' });
    });

    it('a request about an unknown identifier is not a case to decide', async () => {
      const unknown = await requestRecovery(deps(), { identifier: 'nobody@example.com', method: 'LOST_ALL' });
      await expect(
        decideRecovery(deps(), {
          actor: await staff(),
          requestId: unknown.requestId,
          decision: 'APPROVE',
          reason: 'x',
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('the queue and the expiry sweep', () => {
    it('lists real cases only, audited, with no identifier in the payload', async () => {
      const { email } = await withEmail();
      await requestRecovery(deps(), {
        identifier: email,
        method: 'LOST_PHONE',
        evidenceRefs: ['11111111-1111-4111-8111-111111111111'],
      });
      await requestRecovery(deps(), { identifier: 'nobody@example.com', method: 'LOST_PHONE' });

      const actor = await staff();
      const page = await listRecoveryRequests(t.db(), {
        actor,
        reason: 'queue',
        page: 1,
        limit: 10,
        status: 'PENDING',
      });

      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ method: 'LOST_PHONE', status: 'PENDING', evidenceCount: 1 });
      expect(JSON.stringify(page)).not.toContain('example.com');
      expect(
        (
          await t
            .owner()
            .query(`SELECT 1 FROM identity.identity_audit_log WHERE action = 'ADMIN_RECOVERY_LISTED'`)
        ).rows,
      ).toHaveLength(1);
    });

    it('expires requests nobody decided', async () => {
      const { email } = await withEmail();
      const receipt = await requestRecovery(deps(), { identifier: email, method: 'LOST_PHONE' });
      await t
        .owner()
        .query(
          `UPDATE identity.account_recovery_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
          [receipt.requestId],
        );
      expect(await expireRecoveryRequests(t.db())).toBe(1);
      expect(await requestRow(receipt.requestId)).toMatchObject({ status: 'EXPIRED' });
      // And an expired one can no longer be decided.
      await expect(
        decideRecovery(deps(), {
          actor: await staff(),
          requestId: receipt.requestId,
          decision: 'APPROVE',
          reason: 'x',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
