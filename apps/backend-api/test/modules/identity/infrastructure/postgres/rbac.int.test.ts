// M1 §5.5–5.7: credentials, social identities, capabilities and the separation-of-duty rules on
// admin role grants. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { constraintName, errorMessage, insertUser, sqlState } from './support.js';

describe.runIf(infraEnabled)('identity credentials, capabilities and admin rbac', () => {
  const t = useTestDatabase();

  const addRole = (code: string, dual = false) =>
    t
      .app()
      .query(`INSERT INTO identity.roles (code, name, requires_dual_approval) VALUES ($1, $1, $2)`, [
        code,
        dual,
      ]);

  const grant = (userId: string, roleCode: string, grantedBy: string, approvedBy: string | null = null) =>
    t.app().query<{ id: string }>(
      `INSERT INTO identity.admin_role_assignments (user_id, role_code, granted_by, approved_by, reason)
       VALUES ($1, $2, $3, $4, 'test') RETURNING id`,
      [userId, roleCode, grantedBy, approvedBy],
    );

  const addCredential = (userId: string) =>
    t
      .app()
      .query(`INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, '$argon2id$x')`, [
        userId,
      ]);

  const addSocial = (userId: string, { provider = 'GOOGLE', subject = 'sub-1', unlinked = false } = {}) =>
    t.app().query(
      `INSERT INTO identity.social_identities (user_id, provider, provider_user_id, unlinked_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)`,
      [userId, provider, subject, unlinked],
    );

  const addCapability = (userId: string, capability: string) =>
    t
      .app()
      .query(`INSERT INTO identity.user_capabilities (user_id, capability) VALUES ($1, $2)`, [
        userId,
        capability,
      ]);

  it('holds one credential row per user', async () => {
    const user = await insertUser(t.app());
    await addCredential(user);
    expect(await sqlState(addCredential(user))).toBe('23505');
  });

  // A social-only user legitimately has no credential row; password login must still fail with the
  // same generic error, never "this account uses Google" (M1 §5.5).
  it('lets a user have no credential row at all', async () => {
    const user = await insertUser(t.app());
    const { rows } = await t
      .app()
      .query('SELECT user_id FROM identity.user_credentials WHERE user_id = $1', [user]);
    expect(rows).toEqual([]);
  });

  it('defaults credentials to argon2id with no previous hashes', async () => {
    const user = await insertUser(t.app());
    await addCredential(user);
    const { rows } = await t.app().query(
      `SELECT algorithm, previous_hashes, must_change, failed_attempts
         FROM identity.user_credentials WHERE user_id = $1`,
      [user],
    );
    expect(rows[0]).toEqual({
      algorithm: 'argon2id',
      previous_hashes: [],
      must_change: false,
      failed_attempts: 0,
    });
  });

  it('rejects a second live link for the same provider subject', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    await addSocial(a);
    expect(await sqlState(addSocial(b))).toBe('23505');
  });

  it('allows reclaiming a provider subject once the first link is unlinked', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    await addSocial(a, { unlinked: true });
    await expect(addSocial(b)).resolves.toBeDefined();
  });

  it('rejects a second live identity for the same user and provider', async () => {
    const user = await insertUser(t.app());
    await addSocial(user, { subject: 'sub-1' });
    expect(await sqlState(addSocial(user, { subject: 'sub-2' }))).toBe('23505');
  });

  it.each([['MERCHANT'], ['MERCHANT_MEMBER'], ['STAFF']])('accepts the %s capability', async (c) => {
    const user = await insertUser(t.app());
    await expect(addCapability(user, c)).resolves.toBeDefined();
  });

  it('rejects a SELLER capability', async () => {
    const user = await insertUser(t.app());
    expect(await sqlState(addCapability(user, 'SELLER'))).toBe('22P02');
  });

  it('rejects a duplicate capability for one user', async () => {
    const user = await insertUser(t.app());
    await addCapability(user, 'MERCHANT');
    expect(await sqlState(addCapability(user, 'MERCHANT'))).toBe('23505');
  });

  it('rejects an approver who is also the grantor', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('OPERATIONS_ADMIN');
    expect(await constraintName(grant(subject, 'OPERATIONS_ADMIN', admin, admin))).toBe(
      'admin_role_distinct_approver',
    );
  });

  it('rejects a self-grant', async () => {
    const admin = await insertUser(t.app());
    await addRole('OPERATIONS_ADMIN');
    expect(await constraintName(grant(admin, 'OPERATIONS_ADMIN', admin))).toBe('admin_role_no_self_grant');
  });

  it('rejects a dual-approval role with no approver', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('SUPER_ADMIN', true);
    expect(await errorMessage(grant(subject, 'SUPER_ADMIN', admin))).toMatch(
      /SUPER_ADMIN requires a second approver/,
    );
  });

  it('rejects clearing the approver on a dual-approval role', async () => {
    const [subject, admin, approver] = [
      await insertUser(t.app()),
      await insertUser(t.app()),
      await insertUser(t.app()),
    ];
    await addRole('FINANCE_ADMIN', true);
    const { rows } = await grant(subject, 'FINANCE_ADMIN', admin, approver);
    expect(
      await errorMessage(
        t
          .app()
          .query(`UPDATE identity.admin_role_assignments SET approved_by = NULL WHERE id = $1`, [
            rows[0]!.id,
          ]),
      ),
    ).toMatch(/requires a second approver/);
  });

  it('accepts a dual-approval role with a distinct approver', async () => {
    const [subject, admin, approver] = [
      await insertUser(t.app()),
      await insertUser(t.app()),
      await insertUser(t.app()),
    ];
    await addRole('COMPLIANCE_OFFICER', true);
    await expect(grant(subject, 'COMPLIANCE_OFFICER', admin, approver)).resolves.toBeDefined();
  });

  it('accepts a single-approval role with no approver', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('SUPPORT_AGENT');
    await expect(grant(subject, 'SUPPORT_AGENT', admin)).resolves.toBeDefined();
  });

  it('rejects a second live assignment of the same role to the same user', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('SUPPORT_AGENT');
    await grant(subject, 'SUPPORT_AGENT', admin);
    expect(await sqlState(grant(subject, 'SUPPORT_AGENT', admin))).toBe('23505');
  });

  it('allows regranting a role after it is revoked', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('SUPPORT_AGENT');
    const { rows } = await grant(subject, 'SUPPORT_AGENT', admin);
    await t
      .app()
      .query(`UPDATE identity.admin_role_assignments SET revoked_at = now() WHERE id = $1`, [rows[0]!.id]);
    await expect(grant(subject, 'SUPPORT_AGENT', admin)).resolves.toBeDefined();
  });

  it('rejects an approver who is also the requester of an admin action', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    expect(
      await constraintName(
        t.app().query(
          `INSERT INTO identity.admin_action_approvals
             (action, subject_user_id, requested_by, approved_by, reason, expires_at)
           VALUES ('MFA_RESET', $1, $2, $2, 'test', now() + interval '1 day')`,
          [subject, admin],
        ),
      ),
    ).toBe('admin_action_distinct_approver');
  });

  // Four eyes means the person who benefits is not one of the eyes. M1 §5.7 spells out only
  // approver <> grantor, which still lets the grantee sign off on their own elevation.
  it('rejects an approver who is the grantee', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('SUPER_ADMIN', true);
    expect(await constraintName(grant(subject, 'SUPER_ADMIN', admin, subject))).toBe(
      'admin_role_self_approval',
    );
  });

  it('rejects an approver who is the subject of an admin action', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    expect(
      await constraintName(
        t.app().query(
          `INSERT INTO identity.admin_action_approvals
             (action, subject_user_id, requested_by, approved_by, reason, expires_at)
           VALUES ('MFA_RESET', $1, $2, $1, 'test', now() + interval '1 day')`,
          [subject, admin],
        ),
      ),
    ).toBe('admin_action_self_approval');
  });

  // The guard must not become the lock: a BEFORE UPDATE trigger that fires on the revoke statement
  // leaves an unapproved grant live with no way for the app to take it back.
  it('allows revoking a dual-approval grant', async () => {
    const [subject, admin, approver] = [
      await insertUser(t.app()),
      await insertUser(t.app()),
      await insertUser(t.app()),
    ];
    await addRole('FINANCE_ADMIN', true);
    const { rows } = await grant(subject, 'FINANCE_ADMIN', admin, approver);
    await expect(
      t
        .app()
        .query(
          `UPDATE identity.admin_role_assignments SET revoked_at = now(), approved_by = NULL WHERE id = $1`,
          [rows[0]!.id],
        ),
    ).resolves.toBeDefined();
  });

  it('rejects requiring dual approval while unapproved grants of that role are live', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('OPERATIONS_ADMIN');
    await grant(subject, 'OPERATIONS_ADMIN', admin);
    expect(
      await errorMessage(
        t
          .app()
          .query(`UPDATE identity.roles SET requires_dual_approval = true WHERE code = 'OPERATIONS_ADMIN'`),
      ),
    ).toMatch(/unapproved live assignments/);
  });

  it('allows requiring dual approval once the unapproved grants are revoked', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('OPERATIONS_ADMIN');
    const { rows } = await grant(subject, 'OPERATIONS_ADMIN', admin);
    await t
      .app()
      .query(`UPDATE identity.admin_role_assignments SET revoked_at = now() WHERE id = $1`, [rows[0]!.id]);
    await expect(
      t
        .app()
        .query(`UPDATE identity.roles SET requires_dual_approval = true WHERE code = 'OPERATIONS_ADMIN'`),
    ).resolves.toBeDefined();
  });

  // The role_code foreign key takes only a KEY SHARE lock, which a non-key UPDATE of
  // requires_dual_approval does not conflict with: without an explicit row lock the flip slips past
  // an in-flight grant and the result is a live, unapproved dual-approval assignment.
  it('serialises a concurrent flip of requires_dual_approval against an in-flight grant', async () => {
    const [subject, admin] = [await insertUser(t.app()), await insertUser(t.app())];
    await addRole('OPERATIONS_ADMIN');
    const [granter, flipper] = await Promise.all([t.app().connect(), t.app().connect()]);
    try {
      await granter.query('BEGIN');
      await granter.query(
        `INSERT INTO identity.admin_role_assignments (user_id, role_code, granted_by, reason)
         VALUES ($1, 'OPERATIONS_ADMIN', $2, 'test')`,
        [subject, admin],
      );
      const flip = errorMessage(
        flipper.query(
          `UPDATE identity.roles SET requires_dual_approval = true WHERE code = 'OPERATIONS_ADMIN'`,
        ),
      );
      await granter.query('COMMIT');
      expect(await flip).toMatch(/unapproved live assignments/);
    } finally {
      granter.release();
      flipper.release();
    }
  });

  it('cascades role_permissions when a role is deleted', async () => {
    await addRole('SUPPORT_AGENT');
    await t
      .app()
      .query(`INSERT INTO identity.permissions (code, domain, action) VALUES ('user.view', 'user', 'view')`);
    await t.app().query(
      `INSERT INTO identity.role_permissions (role_code, permission_code)
       VALUES ('SUPPORT_AGENT', 'user.view')`,
    );
    await t.app().query(`DELETE FROM identity.roles WHERE code = 'SUPPORT_AGENT'`);
    const { rows } = await t.app().query('SELECT role_code FROM identity.role_permissions');
    expect(rows).toEqual([]);
  });
});
