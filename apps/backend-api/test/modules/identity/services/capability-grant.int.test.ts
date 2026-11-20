// T-055's write half of the capability service: the MERCHANT capability is granted, suspended and revoked
// here and nowhere else, each change audited in the caller's transaction, and canActAsBuyer follows.
import { describe, expect, it } from 'vitest';
import { createDb } from '../../../../src/db/index.js';
import {
  activateCapability,
  createCapabilityService,
  postgresBuyerFacts,
  revokeCapability,
  suspendCapability,
} from '../../../../src/modules/identity/index.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser } from '../support.js';

describe.runIf(infraEnabled)('capability grant, suspension and revocation (T-055)', () => {
  const t = useTestDatabase();
  const db = () => createDb(t.app());

  const status = async (userId: string) =>
    (
      await t.owner().query<{ status: string; activated_at: Date | null; suspension_reason: string | null }>(
        `SELECT status, activated_at, suspension_reason FROM identity.user_capabilities
          WHERE user_id = $1 AND capability = 'MERCHANT'`,
        [userId],
      )
    ).rows[0];
  const audit = async (action: string) =>
    Number(
      (
        await t
          .owner()
          .query<{ n: string }>(`SELECT count(*) AS n FROM identity.identity_audit_log WHERE action = $1`, [
            action,
          ])
      ).rows[0]?.n,
    );

  it('activates the capability, creating the row, and leaves buying open (merchants buy too, 2026-11-20)', async () => {
    const { userId } = await seedUser(t.app());
    const { userId: staffId } = await seedUser(t.app());
    const service = createCapabilityService({ facts: postgresBuyerFacts(db()) });
    expect(await service.canActAsBuyer(userId)).toBe(true);

    const result = await db().transaction((tx) =>
      activateCapability(tx, { userId, capability: 'MERCHANT', grantedBy: staffId, reason: 'Certified' }),
    );
    expect(result).toEqual({ changed: true, from: null });
    expect(await status(userId)).toMatchObject({ status: 'ACTIVE' });
    expect((await status(userId))?.activated_at).not.toBeNull();
    expect(await service.canActAsBuyer(userId)).toBe(true);
    expect(await audit('CAPABILITY_ACTIVATED')).toBe(1);
  });

  it('is idempotent: activating an active capability changes and audits nothing', async () => {
    const { userId } = await seedUser(t.app());
    const grant = () =>
      db().transaction((tx) =>
        activateCapability(tx, { userId, capability: 'MERCHANT', grantedBy: null, reason: 'Certified' }),
      );
    await grant();
    expect(await grant()).toEqual({ changed: false, from: 'ACTIVE' });
    expect(await audit('CAPABILITY_ACTIVATED')).toBe(1);
  });

  it('suspends and revokes with a reason, and restores buying (design 6.3)', async () => {
    const { userId } = await seedUser(t.app());
    const service = createCapabilityService({ facts: postgresBuyerFacts(db()) });
    await db().transaction((tx) =>
      activateCapability(tx, { userId, capability: 'MERCHANT', grantedBy: null, reason: 'Certified' }),
    );

    await db().transaction((tx) =>
      suspendCapability(tx, { userId, capability: 'MERCHANT', reason: 'Under investigation' }),
    );
    expect(await status(userId)).toMatchObject({
      status: 'SUSPENDED',
      suspension_reason: 'Under investigation',
    });
    expect(await service.canActAsBuyer(userId)).toBe(true);
    expect(await audit('CAPABILITY_SUSPENDED')).toBe(1);

    await db().transaction((tx) => revokeCapability(tx, { userId, capability: 'MERCHANT', reason: 'Fraud' }));
    expect(await status(userId)).toMatchObject({ status: 'REVOKED' });
    expect(await audit('CAPABILITY_REVOKED')).toBe(1);
  });

  it('refuses to suspend or revoke a capability the user does not hold', async () => {
    const { userId } = await seedUser(t.app());
    await expect(
      db().transaction((tx) => suspendCapability(tx, { userId, capability: 'MERCHANT', reason: 'x' })),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      db().transaction((tx) => revokeCapability(tx, { userId, capability: 'MERCHANT', reason: 'x' })),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('re-activates a revoked capability, clearing the suspension reason', async () => {
    const { userId } = await seedUser(t.app());
    await db().transaction((tx) =>
      activateCapability(tx, { userId, capability: 'MERCHANT', grantedBy: null, reason: 'a' }),
    );
    await db().transaction((tx) => suspendCapability(tx, { userId, capability: 'MERCHANT', reason: 'why' }));
    const again = await db().transaction((tx) =>
      activateCapability(tx, { userId, capability: 'MERCHANT', grantedBy: null, reason: 'reinstated' }),
    );
    expect(again).toEqual({ changed: true, from: 'SUSPENDED' });
    expect(await status(userId)).toMatchObject({ status: 'ACTIVE', suspension_reason: null });
  });

  it('rolls the change back with the caller’s transaction', async () => {
    const { userId } = await seedUser(t.app());
    await expect(
      db().transaction(async (tx) => {
        await activateCapability(tx, { userId, capability: 'MERCHANT', grantedBy: null, reason: 'x' });
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await status(userId)).toBeUndefined();
    expect(await audit('CAPABILITY_ACTIVATED')).toBe(0);
  });
});
