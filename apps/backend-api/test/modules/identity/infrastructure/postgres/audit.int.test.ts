// M1 §5.11. The audit log only grows: the trigger stops the owner, and komtru_app simply lacks the
// privilege. If the app can rewrite this table, the audit log is decorative.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { grantRuntimeAccess } from '../../../../../src/db/roles.js';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { insertUser, sqlState } from './support.js';

describe.runIf(infraEnabled)('identity.identity_audit_log', () => {
  const t = useTestDatabase();

  const append = (pool: pg.Pool, subjectUserId: string | null = null) =>
    pool.query(
      `INSERT INTO identity.identity_audit_log (actor_type, action, outcome, subject_user_id)
       VALUES ('SYSTEM', 'PASSWORD_CHANGED', 'SUCCESS', $1)`,
      [subjectUserId],
    );

  it('lets the runtime role append and read', async () => {
    await append(t.app());
    const { rows } = await t
      .app()
      .query<{ action: string }>('SELECT action FROM identity.identity_audit_log');
    expect(rows).toEqual([{ action: 'PASSWORD_CHANGED' }]);
  });

  it('denies the runtime role UPDATE', async () => {
    await append(t.app());
    expect(await sqlState(t.app().query(`UPDATE identity.identity_audit_log SET outcome = 'DENIED'`))).toBe(
      '42501',
    );
  });

  it('denies the runtime role DELETE', async () => {
    await append(t.app());
    expect(await sqlState(t.app().query('DELETE FROM identity.identity_audit_log'))).toBe('42501');
  });

  it('raises KT001 on an owner UPDATE', async () => {
    await append(t.owner());
    expect(await sqlState(t.owner().query(`UPDATE identity.identity_audit_log SET outcome = 'DENIED'`))).toBe(
      'KT001',
    );
  });

  it('raises KT001 on an owner DELETE', async () => {
    await append(t.owner());
    expect(await sqlState(t.owner().query('DELETE FROM identity.identity_audit_log'))).toBe('KT001');
  });

  // No foreign key to users: an audit row has to outlive the account it describes, and a cascade
  // would erase exactly the evidence an investigation needs.
  it('keeps the row after its subject user is deleted', async () => {
    const user = await insertUser(t.app());
    await append(t.app(), user);
    await t.app().query(`DELETE FROM identity.users WHERE id = $1`, [user]);
    const { rows } = await t
      .app()
      .query<{ subject_user_id: string }>('SELECT subject_user_id FROM identity.identity_audit_log');
    expect(rows).toEqual([{ subject_user_id: user }]);
  });

  it('stays append-only after a later migrate run refreshes the grants', async () => {
    const client = await t.owner().connect();
    try {
      await grantRuntimeAccess(client);
    } finally {
      client.release();
    }
    await append(t.app());
    expect(await sqlState(t.app().query(`UPDATE identity.identity_audit_log SET outcome = 'DENIED'`))).toBe(
      '42501',
    );
  });
});
