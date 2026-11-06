// The surface of M1 §5, pinned. A later ticket that drops a table, an index or a CHECK fails here
// rather than in production. Skipped unless KOMTRU_INFRA_TESTS=1.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';

const names = async (owner: pg.Pool, query: string): Promise<string[]> => {
  const { rows } = await owner.query<{ name: string }>(query);
  return rows.map((row) => row.name).sort();
};

// M1 §5.2–5.11 in order, sorted here for a readable diff.
const TABLES = [
  'account_recovery_requests',
  'admin_action_approvals',
  'admin_role_assignments',
  'devices',
  'identity_audit_log',
  'mfa_factors',
  'otp_challenges',
  'party_invitations',
  'passkey_credentials',
  'permissions',
  'reserved_usernames',
  'role_permissions',
  'roles',
  'sessions',
  'social_identities',
  'staff_invitations',
  'user_capabilities',
  'user_credentials',
  'user_emails',
  'user_phones',
  'user_profiles',
  'username_history',
  'users',
].sort();

// Every index M1 §5 names, plus the primary keys and the UNIQUE constraints drizzle derives from
// `.primaryKey()` and `.unique()` — those carry drizzle's naming, not the spec's.
const INDEXES = [
  'account_recovery_pending_idx',
  'account_recovery_requests_pkey',
  'account_recovery_user_idx',
  'admin_action_approvals_pending_idx',
  'admin_action_approvals_pkey',
  'admin_role_active_unique',
  'admin_role_assignments_pkey',
  'admin_role_expiry_idx',
  'devices_fingerprint_idx',
  'devices_pkey',
  'devices_user_fingerprint',
  'identity_audit_action_idx',
  'identity_audit_actor_idx',
  'identity_audit_log_pkey',
  'identity_audit_subject_idx',
  'mfa_factors_one_default',
  'mfa_factors_pkey',
  'mfa_factors_user_idx',
  'otp_challenges_expiry',
  'otp_challenges_lookup',
  'otp_challenges_pkey',
  'party_invitations_dest_idx',
  'party_invitations_inviter_idx',
  'party_invitations_pkey',
  'party_invitations_token_hash_unique',
  'passkey_credentials_credential_id_unique',
  'passkey_credentials_pkey',
  'permissions_pkey',
  'reserved_usernames_pkey',
  'role_permissions_role_code_permission_code_pk',
  'roles_pkey',
  'sessions_family_idx',
  'sessions_pkey',
  'sessions_refresh_hash',
  'sessions_user_active_idx',
  'social_identities_one_per_provider',
  'social_identities_pkey',
  'social_identities_provider_subject',
  'social_identities_user_idx',
  'staff_invitations_dest_idx',
  'staff_invitations_invited_by_idx',
  'staff_invitations_pkey',
  'staff_invitations_token_hash_unique',
  'user_capabilities_pkey',
  'user_capabilities_unique',
  'user_credentials_pkey',
  'user_emails_email_idx',
  'user_emails_id_user',
  'user_emails_one_primary',
  'user_emails_pkey',
  'user_emails_user_idx',
  'user_emails_verified_unique',
  'user_phones_id_user',
  'user_phones_one_primary',
  'user_phones_pkey',
  'user_phones_user_idx',
  'user_phones_verified_unique',
  'user_profiles_pkey',
  'username_history_pkey',
  'username_history_quarantine_idx',
  'username_history_user_idx',
  'users_created_at_idx',
  'users_pkey',
  'users_public_id_unique',
  'users_status_idx',
  'users_username_skeleton_unique',
  'users_username_unique',
  'users_ver_level_idx',
].sort();

const CHECKS = [
  'admin_action_distinct_approver',
  'admin_action_self_approval',
  'admin_role_self_approval',
  'admin_role_distinct_approver',
  'admin_role_no_self_grant',
  'phone_e164_format',
  'profile_bio_len',
  'recovery_reviewer_not_subject',
  'users_username_format',
  'users_username_pair',
].sort();

// drizzle has no record of the two composite same-user keys (migration 0007), so only this list
// stops a later `db:generate` quietly dropping them.
const FOREIGN_KEYS = [
  'account_recovery_requests_requested_device_id_devices_id_fk',
  'account_recovery_requests_reviewed_by_users_id_fk',
  'account_recovery_requests_user_id_users_id_fk',
  'admin_action_approvals_approved_by_users_id_fk',
  'admin_action_approvals_requested_by_users_id_fk',
  'admin_action_approvals_subject_user_id_users_id_fk',
  'admin_role_assignments_approved_by_users_id_fk',
  'admin_role_assignments_granted_by_users_id_fk',
  'admin_role_assignments_revoked_by_users_id_fk',
  'admin_role_assignments_role_code_roles_code_fk',
  'admin_role_assignments_user_id_users_id_fk',
  'devices_user_id_users_id_fk',
  'mfa_factors_phone_id_user_phones_id_fk',
  'mfa_factors_user_id_users_id_fk',
  'otp_challenges_user_id_users_id_fk',
  'party_invitations_claimed_by_user_id_users_id_fk',
  'party_invitations_inviter_user_id_users_id_fk',
  'passkey_credentials_user_id_users_id_fk',
  'role_permissions_permission_code_permissions_code_fk',
  'role_permissions_role_code_roles_code_fk',
  'sessions_device_id_devices_id_fk',
  'sessions_parent_session_id_sessions_id_fk',
  'sessions_user_id_users_id_fk',
  'social_identities_user_id_users_id_fk',
  'staff_invitations_bound_user_id_users_id_fk',
  'staff_invitations_cancelled_by_users_id_fk',
  'staff_invitations_claimed_by_user_id_users_id_fk',
  'staff_invitations_invited_by_users_id_fk',
  'staff_invitations_role_code_roles_code_fk',
  'user_capabilities_granted_by_users_id_fk',
  'user_capabilities_user_id_users_id_fk',
  'user_credentials_user_id_users_id_fk',
  'user_emails_user_id_users_id_fk',
  'user_phones_user_id_users_id_fk',
  'user_profiles_user_id_users_id_fk',
  'username_history_changed_by_users_id_fk',
  'username_history_user_id_users_id_fk',
  'users_primary_email_fk',
  'users_primary_phone_fk',
].sort();

describe.runIf(infraEnabled)('the identity schema surface', () => {
  const t = useTestDatabase();

  it('has exactly the M1 §5 tables', async () => {
    expect(
      await names(
        t.owner(),
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'identity' AND c.relkind IN ('r', 'p')`,
      ),
    ).toEqual(TABLES);
  });

  it('has exactly the M1 §5 indexes', async () => {
    expect(
      await names(t.owner(), `SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'identity'`),
    ).toEqual(INDEXES);
  });

  it('has exactly the M1 §5 check constraints', async () => {
    expect(
      await names(
        t.owner(),
        `SELECT con.conname AS name FROM pg_constraint con
           JOIN pg_namespace n ON n.oid = con.connamespace
          WHERE n.nspname = 'identity' AND con.contype = 'c'`,
      ),
    ).toEqual(CHECKS);
  });

  it('has exactly the M1 §5 foreign keys', async () => {
    expect(
      await names(
        t.owner(),
        `SELECT con.conname AS name FROM pg_constraint con
           JOIN pg_namespace n ON n.oid = con.connamespace
          WHERE n.nspname = 'identity' AND con.contype = 'f'`,
      ),
    ).toEqual(FOREIGN_KEYS);
  });

  // `ORDER BY x DESC` is DESC NULLS FIRST. drizzle's `.desc()` emits DESC NULLS LAST, whose
  // pathkeys do not match, so the planner sorts every matching row instead of walking the index —
  // measured as a Sort over a Bitmap Heap Scan rather than an Index Scan under LIMIT.
  it('orders every DESC index NULLS FIRST, so a plain ORDER BY DESC can walk it', async () => {
    const { rows } = await t.owner().query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'identity' AND indexdef LIKE '%DESC NULLS LAST%'`,
    );
    expect(rows.map((row) => row.indexname)).toEqual([]);
  });

  it('carries the four-eyes and append-only triggers and nothing else', async () => {
    expect(
      await names(
        t.owner(),
        `SELECT tg.tgname AS name FROM pg_trigger tg
           JOIN pg_class c ON c.oid = tg.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'identity' AND NOT tg.tgisinternal`,
      ),
    ).toEqual(['admin_role_dual_approval', 'komtru_append_only', 'roles_dual_approval_backfill']);
  });

  // One privilege per call: has_table_privilege('SELECT, INSERT') is OR, so a table that lost
  // INSERT would pass a combined check.
  it.each([['SELECT'], ['INSERT']])(
    'grants the runtime role %s on every identity table',
    async (privilege) => {
      const { rows } = await t.owner().query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'identity' AND c.relkind = 'r'
            AND NOT has_table_privilege('komtru_app', c.oid, $1)`,
        [privilege],
      );
      expect(rows).toEqual([]);
    },
  );
});
