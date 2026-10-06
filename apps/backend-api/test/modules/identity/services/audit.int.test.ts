// §S10's record, against a real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, writeAudit } from '../../../../src/modules/identity/services/audit.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser } from '../support.js';

interface AuditRow {
  action: string;
  outcome: string;
  actor_type: string;
  actor_user_id: string | null;
  subject_user_id: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
}

describe.runIf(infraEnabled)('the identity audit log', () => {
  const t = useTestDatabase();

  const rows = async (): Promise<AuditRow[]> =>
    (await t.app().query<AuditRow>(`SELECT * FROM identity.identity_audit_log ORDER BY id`)).rows;

  it('writes one row inside the caller transaction', async () => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction((tx) =>
      writeAudit(tx, {
        action: AUDIT_ACTIONS.LOGIN,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        ip: '203.0.113.9',
        metadata: { amr: ['pwd'] },
      }),
    );

    expect(await rows()).toMatchObject([
      {
        action: 'LOGIN',
        outcome: 'SUCCESS',
        actor_type: 'USER',
        actor_user_id: userId,
        subject_user_id: userId,
        ip: '203.0.113.9',
        metadata: { amr: ['pwd'] },
      },
    ]);
  });

  it('rolls back with the change it describes, so there is no row for work that never happened', async () => {
    const { userId } = await seedUser(t.app());
    await expect(
      t.db().transaction(async (tx) => {
        await writeAudit(tx, {
          action: AUDIT_ACTIONS.PASSWORD_CHANGED,
          outcome: 'SUCCESS',
          subjectUserId: userId,
        });
        throw new Error('the change failed after the audit row');
      }),
    ).rejects.toThrow('the change failed after the audit row');

    expect(await rows()).toEqual([]);
  });

  it('accepts an actor nobody can resolve', async () => {
    await t.db().transaction((tx) =>
      writeAudit(tx, {
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        outcome: 'FAILURE',
        actorType: 'ANONYMOUS',
        metadata: { identifierHash: 'ab12', reason: 'rejected' },
      }),
    );
    expect(await rows()).toMatchObject([
      { actor_type: 'ANONYMOUS', actor_user_id: null, subject_user_id: null },
    ]);
  });

  it('defaults an unnamed actor to SYSTEM rather than to a user', async () => {
    await t.db().transaction((tx) => writeAudit(tx, { action: 'SWEEP', outcome: 'SUCCESS' }));
    expect((await rows())[0]?.actor_type).toBe('SYSTEM');
  });

  it('cannot be updated or deleted afterwards (T-030 migration 0012, error KT001)', async () => {
    const { userId } = await seedUser(t.app());
    await t
      .db()
      .transaction((tx) =>
        writeAudit(tx, { action: AUDIT_ACTIONS.LOGIN, outcome: 'SUCCESS', subjectUserId: userId }),
      );
    await expect(
      t.app().query(`UPDATE identity.identity_audit_log SET outcome = 'FAILURE'`),
    ).rejects.toMatchObject({ code: 'KT001' });
    await expect(t.app().query(`DELETE FROM identity.identity_audit_log`)).rejects.toMatchObject({
      code: 'KT001',
    });
  });
});
