// T-037: how a module that owns a foreign two-step action (M6's verification override, M8's refunds)
// spends an approval, and the capability lookup behind `canActAsBuyer(userId)`.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../src/platform/errors.js';
import {
  consumeApproval,
  approvalState,
} from '../../../../src/modules/identity/services/approval.service.js';
import {
  createCapabilityService,
  postgresMerchantStatus,
} from '../../../../src/modules/identity/services/capability.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser } from '../support.js';

describe.runIf(infraEnabled)('consuming an approval', () => {
  const t = useTestDatabase();

  const seed = async (
    overrides: {
      action?: string;
      approved?: boolean;
      rejected?: boolean;
      expired?: boolean;
      executed?: boolean;
    } = {},
  ) => {
    const { userId: subject } = await seedUser(t.app());
    const { userId: requester } = await seedUser(t.app());
    const { userId: approver } = await seedUser(t.app());
    const { userId: actor } = await seedUser(t.app());
    const approved = overrides.approved ?? true;
    const { rows } = await t.owner().query<{ id: string }>(
      `INSERT INTO identity.admin_action_approvals
         (action, subject_user_id, requested_by, approved_by, approved_at, rejected_at, executed_at, reason, expires_at)
       VALUES ($1, $2, $3, $4, ${approved ? 'now()' : 'NULL'}, ${overrides.rejected ? 'now()' : 'NULL'},
               ${overrides.executed ? 'now()' : 'NULL'}, 'test', now() + ${overrides.expired ? `interval '-1 hour'` : `interval '1 hour'`})
       RETURNING id`,
      [overrides.action ?? 'VERIFICATION_OVERRIDE', subject, requester, approved ? approver : null],
    );
    return { id: rows[0]?.id ?? '', subject, requester, approver, actor };
  };

  const consume = (input: {
    id: string;
    action?: 'VERIFICATION_OVERRIDE' | 'LARGE_REFUND';
    subject: string;
    by: string;
  }) =>
    t.db().transaction((tx) =>
      consumeApproval(tx, {
        approvalId: input.id,
        action: input.action ?? 'VERIFICATION_OVERRIDE',
        subjectUserId: input.subject,
        consumedBy: input.by,
      }),
    );

  const status = async (rejects: Promise<unknown>): Promise<number | undefined> => {
    try {
      await rejects;
      return undefined;
    } catch (error) {
      return error instanceof ApiError ? error.status : -1;
    }
  };

  it('spends an approved action once, for the subject it was approved for', async () => {
    const a = await seed();
    await consume({ id: a.id, subject: a.subject, by: a.actor });
    const { rows } = await t
      .owner()
      .query<{ executed_at: Date | null }>(
        `SELECT executed_at FROM identity.admin_action_approvals WHERE id = $1`,
        [a.id],
      );
    expect(rows[0]?.executed_at).not.toBeNull();
    expect(await status(consume({ id: a.id, subject: a.subject, by: a.actor }))).toBe(409);
  });

  it('refuses the wrong action, the wrong subject and an unknown id', async () => {
    const a = await seed();
    const other = await seed();
    expect(await status(consume({ id: a.id, action: 'LARGE_REFUND', subject: a.subject, by: a.actor }))).toBe(
      404,
    );
    expect(await status(consume({ id: a.id, subject: other.subject, by: a.actor }))).toBe(404);
    expect(
      await status(consume({ id: '0190a6e0-0000-7000-8000-000000000000', subject: a.subject, by: a.actor })),
    ).toBe(404);
  });

  it('refuses an unapproved, a rejected and an expired approval', async () => {
    const unapproved = await seed({ approved: false });
    const rejected = await seed({ approved: false, rejected: true });
    const expired = await seed({ expired: true });
    expect(
      await status(consume({ id: unapproved.id, subject: unapproved.subject, by: unapproved.actor })),
    ).toBe(403);
    expect(await status(consume({ id: rejected.id, subject: rejected.subject, by: rejected.actor }))).toBe(
      403,
    );
    expect(await status(consume({ id: expired.id, subject: expired.subject, by: expired.actor }))).toBe(409);
  });

  it('refuses the approver acting on their own approval', async () => {
    const a = await seed();
    expect(await status(consume({ id: a.id, subject: a.subject, by: a.approver }))).toBe(403);
  });

  it('derives the state a list shows', async () => {
    const { rows } = await t.owner().query(`SELECT 1`);
    expect(rows).toHaveLength(1);
    const now = new Date();
    const base = {
      id: 'x',
      action: 'MFA_RESET',
      subjectUserId: 's',
      requestedBy: 'r',
      approvedBy: null,
      reason: 'r',
      payload: null,
      requestedAt: now,
      approvedAt: null,
      executedAt: null,
      expiresAt: new Date(now.getTime() + 1000),
      rejectedAt: null,
      rejectionReason: null,
    };
    expect(approvalState(base)).toBe('PENDING');
    expect(approvalState({ ...base, expiresAt: new Date(now.getTime() - 1) })).toBe('EXPIRED');
    expect(approvalState({ ...base, approvedAt: now })).toBe('APPROVED');
    expect(approvalState({ ...base, approvedAt: now, executedAt: now })).toBe('EXECUTED');
    expect(approvalState({ ...base, rejectedAt: now })).toBe('REJECTED');
  });
});

describe.runIf(infraEnabled)('canActAsBuyer(userId) against Postgres', () => {
  const t = useTestDatabase();

  const withCapability = async (status: string | null) => {
    const { userId } = await seedUser(t.app());
    if (status) {
      await t
        .owner()
        .query(
          `INSERT INTO identity.user_capabilities (user_id, capability, status) VALUES ($1, 'MERCHANT', $2::identity.capability_status)`,
          [userId, status],
        );
    }
    return userId;
  };

  it('is false only while the MERCHANT capability is ACTIVE', async () => {
    const service = createCapabilityService({ merchantStatus: postgresMerchantStatus(t.db()) });
    expect(await service.canActAsBuyer(await withCapability(null))).toBe(true);
    expect(await service.canActAsBuyer(await withCapability('PENDING'))).toBe(true);
    expect(await service.canActAsBuyer(await withCapability('ACTIVE'))).toBe(false);
    expect(await service.canActAsBuyer(await withCapability('SUSPENDED'))).toBe(true);
    expect(await service.canActAsBuyer(await withCapability('REVOKED'))).toBe(true);
  });

  it('is true for an ACTIVE merchant whose trade is already in flight, and false again for a new one', async () => {
    const service = createCapabilityService({ merchantStatus: postgresMerchantStatus(t.db()) });
    const merchant = await withCapability('ACTIVE');
    expect(await service.canActAsBuyer(merchant, { tradeInFlight: true })).toBe(true);
    expect(await service.canActAsBuyer(merchant)).toBe(false);
  });
});
