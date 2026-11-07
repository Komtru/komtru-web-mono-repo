/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- raw `pg` rows and supertest bodies are untyped in assertions */
// T-039 / M1 section 15: the anonymisation procedure, and the export and erasure hand-offs.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it, vi } from 'vitest';
import { getCitiesByIds, seedLocations } from '../../../../src/modules/geo/index.js';
import { createAddress } from '../../../../src/modules/identity/services/address.service.js';
import type { LifecyclePorts } from '../../../../src/modules/identity/services/lifecycle.service.js';
import {
  anonymiseUser,
  requestDataExport,
  requestErasure,
  type NdpaDeps,
} from '../../../../src/modules/identity/services/ndpa.service.js';
import { skeleton } from '../../../../src/modules/identity/domain/username/skeleton.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { countingHasher, grantRole, outboxEventTypes, seedUser, testLogger } from '../support.js';

const noTrades: LifecyclePorts = { hasActiveTrades: () => Promise.resolve(false) };
const PASSWORD = 'correct horse battery';

describe.runIf(infraEnabled)('NDPA hooks and anonymisation (T-039)', () => {
  const t = useTestDatabase();

  const deps = (over: Partial<NdpaDeps> = {}): NdpaDeps => ({
    db: t.db(),
    ports: noTrades,
    hasher: countingHasher(),
    breach: { enabled: false, logger: testLogger },
    logger: testLogger,
    ...over,
  });

  /** A closed user holding one of everything the procedure must destroy. */
  const richUser = async (status = 'CLOSED', handle = 'jane.doe') => {
    const { userId, publicId } = await seedUser(t.app(), { status });
    const q = (sql: string, params: unknown[] = []) => t.owner().query(sql, params);
    await q(
      `UPDATE identity.users SET username = $3, username_skeleton = $2, registration_ip = '203.0.113.9',
              consent_ip = '203.0.113.9', last_login_at = now(), closed_at = now() - interval '31 days'
        WHERE id = $1`,
      [userId, skeleton(handle), handle],
    );
    await q(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
       VALUES ($1, $2, $2, true, now())`,
      [userId, `${handle}@example.com`],
    );
    await q(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
       VALUES ($1, $2, 'NG', true, now())`,
      [userId, `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`],
    );
    await q(
      `UPDATE identity.users SET primary_email_id = (SELECT id FROM identity.user_emails WHERE user_id = $1),
                    primary_phone_id = (SELECT id FROM identity.user_phones WHERE user_id = $1) WHERE id = $1`,
      [userId],
    );
    await q(`INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, 'x')`, [userId]);
    await q(
      `INSERT INTO identity.user_profiles (user_id, display_name, first_name, last_name, avatar_file_id, bio)
       VALUES ($1, 'Jane D', 'Jane', 'Doe', gen_random_uuid(), 'hello')`,
      [userId],
    );
    await q(
      `INSERT INTO identity.username_history (user_id, username, username_skeleton, claimed_at)
       VALUES ($1, $3, $2, now())`,
      [userId, skeleton(handle), handle],
    );
    await q(
      `INSERT INTO identity.party_invitations (inviter_user_id, channel, destination_hash, destination_masked, destination_enc,
                                               intended_role, token_hash, expires_at)
       VALUES ($1, 'EMAIL', sha256(gen_random_uuid()::text::bytea), 'j••••@x.com', 'secret'::bytea, 'BUYER', sha256(gen_random_uuid()::text::bytea), now() + interval '1 day')`,
      [userId],
    );
    await q(
      `INSERT INTO identity.sessions (user_id, scope, family_id, refresh_token_hash, amr, absolute_expires_at, idle_expires_at)
       VALUES ($1, 'CONSUMER', gen_random_uuid(), sha256(gen_random_uuid()::text::bytea), ARRAY['pwd'], now() + interval '1 day', now() + interval '1 hour')`,
      [userId],
    );
    return { userId, publicId };
  };

  const count = async (table: string, userId: string, column = 'user_id'): Promise<number> =>
    Number(
      (
        await t
          .owner()
          .query<{ n: string }>(`SELECT count(*) n FROM identity.${table} WHERE ${column} = $1`, [userId])
      ).rows[0]?.n,
    );

  describe('anonymiseUser', () => {
    it('scrubs every identifier, keeps the row, and retires the handle forever', async () => {
      const { userId } = await richUser();
      const tombstoneUserFiles = vi.fn().mockResolvedValue(['file-1']);

      const result = await anonymiseUser(deps({ tombstoneUserFiles }), { userId, trigger: 'RETENTION' });
      expect(result.anonymised).toBe(true);

      const { rows } = await t.owner().query(`SELECT * FROM identity.users WHERE id = $1`, [userId]);
      const user = rows[0];
      expect(user).toMatchObject({
        status: 'ANONYMISED',
        primary_email_id: null,
        primary_phone_id: null,
        registration_ip: null,
        consent_ip: null,
        last_login_at: null,
      });
      expect(user.anonymised_at).not.toBeNull();
      expect(user.username).toMatch(/^deleted_[0-9a-f]{12}$/);
      expect(user.username_skeleton).toBe(skeleton(user.username));
      expect(user.sessions_epoch).toBeGreaterThan(1);

      for (const table of [
        'user_emails',
        'user_phones',
        'social_identities',
        'user_credentials',
        'devices',
        'passkey_credentials',
        'mfa_factors',
        'otp_challenges',
        'username_history',
      ]) {
        expect(await count(table, userId), table).toBe(0);
      }
      expect(await count('sessions', userId)).toBe(1);
      expect(
        (
          await t
            .owner()
            .query(`SELECT revoked_at, revoke_reason FROM identity.sessions WHERE user_id = $1`, [userId])
        ).rows[0],
      ).toMatchObject({ revoke_reason: expect.any(String) });
      expect(
        (await t.owner().query(`SELECT revoked_at FROM identity.sessions WHERE user_id = $1`, [userId]))
          .rows[0].revoked_at,
      ).not.toBeNull();

      const profile = (
        await t.owner().query(`SELECT * FROM identity.user_profiles WHERE user_id = $1`, [userId])
      ).rows[0];
      expect(profile).toMatchObject({
        display_name: 'Deleted User',
        first_name: null,
        last_name: null,
        avatar_file_id: null,
        bio: null,
        date_of_birth: null,
        gender: null,
      });

      const invitation = (
        await t
          .owner()
          .query(
            `SELECT destination_masked, octet_length(destination_enc) AS n FROM identity.party_invitations WHERE inviter_user_id = $1`,
            [userId],
          )
      ).rows[0];
      expect(invitation).toMatchObject({ destination_masked: '•••', n: 0 });

      // The old handle can never be re-claimed.
      const reserved = await t
        .owner()
        .query(`SELECT category FROM identity.reserved_usernames WHERE username_skeleton = $1`, [
          skeleton('jane.doe'),
        ]);
      expect(reserved.rows[0]).toMatchObject({ category: 'SYSTEM' });

      // The audit log is untouched by erasure, and records the erasure itself without the handle.
      const audit = await t
        .owner()
        .query(
          `SELECT metadata FROM identity.identity_audit_log WHERE subject_user_id = $1 AND action = 'ACCOUNT_ANONYMISED'`,
          [userId],
        );
      expect(audit.rows).toHaveLength(1);
      expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('jane');

      const events = await outboxEventTypes(t.owner());
      expect(events).toContain('identity.account.anonymised');
      expect(events).toContain('identity.user.status_changed');
    });

    it('leaves no staff prose or requester network data behind', async () => {
      const { userId } = await richUser();
      await t
        .owner()
        .query(`UPDATE identity.users SET status_reason = 'fraud ring 7 (Ada Obi)' WHERE id = $1`, [userId]);
      await t.owner().query(
        `INSERT INTO identity.account_recovery_requests (user_id, claimed_identifier_hash, method, status, requested_ip,
                                                          decision_reason, expires_at)
         VALUES ($1, sha256('secret'::bytea), 'LOST_ALL', 'REJECTED', '203.0.113.9', 'caller was Ada', now())`,
        [userId],
      );

      await anonymiseUser(deps(), { userId, trigger: 'COMPLIANCE' });

      expect(
        (await t.owner().query(`SELECT status_reason FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status_reason: null });
      const recovery = (
        await t.owner().query(
          `SELECT requested_ip, requested_device_id, octet_length(claimed_identifier_hash) n, decision_reason
             FROM identity.account_recovery_requests WHERE user_id = $1`,
          [userId],
        )
      ).rows[0];
      expect(recovery).toMatchObject({
        requested_ip: null,
        requested_device_id: null,
        n: 0,
        decision_reason: null,
      });
      // The event the rest of the platform keeps carries a code, not words.
      const reasons = (
        await t
          .owner()
          .query(
            `SELECT payload->>'reason' r FROM platform.outbox WHERE event_type = 'identity.user.status_changed'`,
          )
      ).rows.map((r) => r.r);
      expect(reasons).toEqual(['ERASURE_FULFILLED']);
    });

    it('takes anonymisedAt from the database clock, so column and event agree', async () => {
      const { userId } = await richUser();
      await anonymiseUser(deps(), { userId, trigger: 'COMPLIANCE' });
      const column = (
        await t.owner().query(`SELECT anonymised_at FROM identity.users WHERE id = $1`, [userId])
      ).rows[0].anonymised_at as Date;
      const event = (
        await t
          .owner()
          .query(
            `SELECT payload->>'anonymisedAt' a FROM platform.outbox WHERE event_type = 'identity.account.anonymised'`,
          )
      ).rows[0].a as string;
      expect(new Date(event).getTime()).toBe(column.getTime());
    });

    it('scrubs and archives saved addresses, never deleting them', async () => {
      await seedLocations(t.db());
      const { userId } = await richUser('ACTIVE');
      const { rows: cities } = await t
        .owner()
        .query<{ id: string; state_id: string }>(`SELECT id, state_id FROM geo.cities ORDER BY name LIMIT 1`);
      await createAddress(
        { db: t.db(), cities: getCitiesByIds },
        {
          userId,
          request: { ip: null, userAgent: null, sessionId: null },
          body: {
            label: 'Home',
            recipientName: 'Adaeze Obiora',
            recipientPhone: '08012345678',
            streetLine: '12 Allen Avenue',
            landmark: null,
            stateId: cities[0]?.state_id ?? '',
            cityId: cities[0]?.id ?? '',
          },
        },
      );
      await t
        .owner()
        .query(
          `UPDATE identity.users SET status = 'CLOSED', closed_at = now() - interval '31 days' WHERE id = $1`,
          [userId],
        );

      await anonymiseUser(deps(), { userId, trigger: 'RETENTION' });

      const { rows } = await t
        .owner()
        .query(
          `SELECT recipient_name, street_line, archived_at, is_default FROM identity.user_addresses WHERE user_id = $1`,
          [userId],
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ is_default: false });
      expect(rows[0].archived_at).not.toBeNull();
      expect(JSON.stringify(rows[0])).not.toContain('Adaeze');
      expect(JSON.stringify(rows[0])).not.toContain('Allen');
    });

    it('tombstones the files after the commit, and survives the files port failing', async () => {
      const { userId } = await richUser();
      const avatar = (
        await t
          .owner()
          .query<{ a: string }>(`SELECT avatar_file_id AS a FROM identity.user_profiles WHERE user_id = $1`, [
            userId,
          ])
      ).rows[0]?.a;
      const tombstoneUserFiles = vi.fn().mockRejectedValue(new Error('cloudinary down'));

      const result = await anonymiseUser(deps({ tombstoneUserFiles }), { userId, trigger: 'RETENTION' });

      expect(result).toMatchObject({ anonymised: true, filesTombstoned: false });
      expect(tombstoneUserFiles).toHaveBeenCalledWith(
        expect.objectContaining({ userId, avatarFileId: avatar }),
      );
      expect(
        (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status: 'ANONYMISED' });
      expect(await outboxEventTypes(t.owner())).toContain('identity.account.anonymised');
    });

    it('is idempotent on an anonymised account', async () => {
      const { userId } = await richUser();
      await anonymiseUser(deps(), { userId, trigger: 'RETENTION' });
      const again = await anonymiseUser(deps(), { userId, trigger: 'RETENTION' });
      expect(again).toMatchObject({ anonymised: false });
      expect(
        (await outboxEventTypes(t.owner())).filter((e) => e === 'identity.account.anonymised'),
      ).toHaveLength(1);
    });

    it('refuses anything but a closed account', async () => {
      for (const status of ['ACTIVE', 'SUSPENDED', 'LOCKED', 'RESTRICTED', 'PENDING_VERIFICATION']) {
        const { userId } = await seedUser(t.app(), { status });
        await expect(anonymiseUser(deps(), { userId, trigger: 'COMPLIANCE' }), status).rejects.toMatchObject({
          code: 'INVALID_TRANSITION',
        });
      }
    });

    it('waits out the retention period unless compliance has fulfilled a request', async () => {
      const { userId } = await richUser();
      await t
        .owner()
        .query(`UPDATE identity.users SET closed_at = now() - interval '2 days' WHERE id = $1`, [userId]);
      await expect(anonymiseUser(deps(), { userId, trigger: 'RETENTION' })).rejects.toMatchObject({
        status: 409,
      });
      expect(
        (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status: 'CLOSED' });

      const done = await anonymiseUser(deps(), { userId, trigger: 'COMPLIANCE' });
      expect(done.anonymised).toBe(true);
    });

    it('refuses while a trade is active, and for a staff member', async () => {
      const a = await richUser();
      await expect(
        anonymiseUser(deps({ ports: { hasActiveTrades: () => Promise.resolve(true) } }), {
          userId: a.userId,
          trigger: 'COMPLIANCE',
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        anonymiseUser(deps({ ports: {} }), { userId: a.userId, trigger: 'COMPLIANCE' }),
      ).rejects.toMatchObject({ status: 409 });

      const b = await richUser('CLOSED', 'staff.member');
      await grantRole(t.owner(), b.userId, 'SUPPORT_AGENT', ['user.view']);
      await expect(anonymiseUser(deps(), { userId: b.userId, trigger: 'COMPLIANCE' })).rejects.toMatchObject({
        status: 409,
      });
    });

    it('rolls back whole when a step fails', async () => {
      const { userId } = await richUser();
      // A second account already holds the tombstone this run will pick: force it by monkeying the
      // generator is not possible, so provoke a failure inside the transaction instead.
      await expect(
        anonymiseUser(deps({ ports: { hasActiveTrades: () => Promise.reject(new Error('boom')) } }), {
          userId,
          trigger: 'COMPLIANCE',
        }),
      ).rejects.toThrow('boom');
      expect(
        (await t.owner().query(`SELECT status::text, username FROM identity.users WHERE id = $1`, [userId]))
          .rows[0],
      ).toMatchObject({ status: 'CLOSED', username: 'jane.doe' });
      expect(await count('user_emails', userId)).toBe(1);
    });
  });

  describe('requestDataExport', () => {
    it('emits one event and a receipt; a repeat within a day returns the same receipt', async () => {
      const { userId } = await seedUser(t.app());
      const first = await requestDataExport(deps(), { userId });
      const second = await requestDataExport(deps(), { userId });

      expect(first.outcome).toBe('REQUESTED');
      expect(second.outcome).toBe('ALREADY_REQUESTED');
      expect(second.requestedAt).toBe(first.requestedAt);
      expect(new Date(first.dueBy).getTime() - new Date(first.requestedAt).getTime()).toBe(30 * 86_400_000);
      expect(
        (await outboxEventTypes(t.owner())).filter((e) => e === 'identity.account.data_export_requested'),
      ).toHaveLength(1);
    });
  });

  describe('requestErasure', () => {
    it('closes the account behind the password and hands off to compliance', async () => {
      const { userId } = await seedUser(t.app());
      await t
        .owner()
        .query(`INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
          userId,
          `$argon2id$v=19$m=19456,t=2,p=1$test$${PASSWORD}`,
        ]);

      const receipt = await requestErasure(deps(), { userId, reasonCode: 'OTHER', password: PASSWORD });

      expect(new Date(receipt.scheduledFor).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
      expect(
        (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status: 'CLOSED' });
      const events = await outboxEventTypes(t.owner());
      expect(events).toContain('identity.account.erasure_requested');
      // The account is closed, not anonymised: compliance decides legal hold first.
      expect(
        (await t.owner().query(`SELECT anonymised_at FROM identity.users WHERE id = $1`, [userId])).rows[0]
          .anonymised_at,
      ).toBeNull();
    });

    it('does nothing while a trade is active, and for a wrong password', async () => {
      const { userId } = await seedUser(t.app());
      await t
        .owner()
        .query(`INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
          userId,
          `$argon2id$v=19$m=19456,t=2,p=1$test$${PASSWORD}`,
        ]);
      await expect(
        requestErasure(deps({ ports: { hasActiveTrades: () => Promise.resolve(true) } }), {
          userId,
          reasonCode: 'OTHER',
          password: PASSWORD,
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        requestErasure(deps(), { userId, reasonCode: 'OTHER', password: 'wrong' }),
      ).rejects.toMatchObject({
        status: 401,
      });
      expect(
        (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0],
      ).toMatchObject({ status: 'ACTIVE' });
      expect(await outboxEventTypes(t.owner())).not.toContain('identity.account.erasure_requested');
    });
  });
});
