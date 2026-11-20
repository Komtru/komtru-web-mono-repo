// T-037: how a module that owns a foreign two-step action (M6's verification override, M8's refunds)
// spends an approval, and the capability lookup behind `canActAsBuyer(userId)`.
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../../src/platform/errors.js';
import {
  consumeApproval,
  approvalState,
} from '../../../../src/modules/identity/services/approval.service.js';
import {
  createCapabilityService,
  postgresBuyerFacts,
} from '../../../../src/modules/identity/services/capability.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser } from '../support.js';
import { assignRole, seedCatalogue } from '../http/staff.support.js';

describe.runIf(infraEnabled)('consuming an approval', () => {
  const t = useTestDatabase();
  const PAYLOAD = { level: 'IDENTITY_VERIFIED', ref: 'case-7' };

  beforeEach(async () => {
    await seedCatalogue(t);
  });

  const seed = async (
    overrides: {
      action?: string;
      approved?: boolean;
      rejected?: boolean;
      expired?: boolean;
      executed?: boolean;
      requesterRole?: string | null;
    } = {},
  ) => {
    const { userId: subject } = await seedUser(t.app());
    const { userId: requester } = await seedUser(t.app());
    const { userId: approver } = await seedUser(t.app());
    const { userId: stranger } = await seedUser(t.app());
    const role = overrides.requesterRole === undefined ? 'KYC_ANALYST' : overrides.requesterRole;
    if (role) await assignRole(t, requester, role);
    const approved = overrides.approved ?? true;
    const { rows } = await t.owner().query<{ id: string }>(
      `INSERT INTO identity.admin_action_approvals
         (action, subject_user_id, requested_by, approved_by, approved_at, rejected_at, executed_at, reason, payload, expires_at)
       VALUES ($1, $2, $3, $4, ${approved ? 'now()' : 'NULL'}, ${overrides.rejected ? 'now()' : 'NULL'},
               ${overrides.executed ? 'now()' : 'NULL'}, 'test', $5::jsonb,
               now() + ${overrides.expired ? `interval '-1 hour'` : `interval '1 hour'`})
       RETURNING id`,
      [
        overrides.action ?? 'VERIFICATION_OVERRIDE',
        subject,
        requester,
        approved ? approver : null,
        JSON.stringify(PAYLOAD),
      ],
    );
    return { id: rows[0]?.id ?? '', subject, requester, approver, stranger };
  };

  const consume = (input: {
    id: string;
    action?: 'VERIFICATION_OVERRIDE' | 'LARGE_REFUND';
    subject: string;
    by: string;
    payload?: Record<string, unknown>;
  }) =>
    t.db().transaction((tx) =>
      consumeApproval(tx, {
        approvalId: input.id,
        action: input.action ?? 'VERIFICATION_OVERRIDE',
        subjectUserId: input.subject,
        expectedPayload: input.payload ?? PAYLOAD,
        consumedBy: input.by,
      }),
    );

  const status = async (attempt: Promise<unknown>): Promise<number | undefined> => {
    try {
      await attempt;
      return undefined;
    } catch (error) {
      return error instanceof ApiError ? error.status : -1;
    }
  };

  it('spends an approved action once, for the subject and payload it was approved for, by its requester', async () => {
    const a = await seed();
    await consume({ id: a.id, subject: a.subject, by: a.requester });
    const { rows } = await t
      .owner()
      .query<{ executed_at: Date | null }>(
        `SELECT executed_at FROM identity.admin_action_approvals WHERE id = $1`,
        [a.id],
      );
    expect(rows[0]?.executed_at).not.toBeNull();
    expect(await status(consume({ id: a.id, subject: a.subject, by: a.requester }))).toBe(409);
  });

  it('ignores the order of payload keys, and nothing else about the payload', async () => {
    const a = await seed();
    await consume({
      id: a.id,
      subject: a.subject,
      by: a.requester,
      payload: { ref: 'case-7', level: 'IDENTITY_VERIFIED' },
    });
  });

  it('refuses a payload that differs in any value, any extra key, or any missing key', async () => {
    const a = await seed();
    for (const payload of [
      { ...PAYLOAD, level: 'ENHANCED' },
      { ...PAYLOAD, extra: 1 },
      { level: PAYLOAD.level },
      {},
    ])
      expect(await status(consume({ id: a.id, subject: a.subject, by: a.requester, payload }))).toBe(403);
    // And a refused attempt spends nothing.
    await consume({ id: a.id, subject: a.subject, by: a.requester });
  });

  it('refuses a third party, and the approver, acting on the requester’s approval', async () => {
    const a = await seed();
    expect(await status(consume({ id: a.id, subject: a.subject, by: a.stranger }))).toBe(403);
    expect(await status(consume({ id: a.id, subject: a.subject, by: a.approver }))).toBe(403);
  });

  it('refuses when the requester has since lost the permission', async () => {
    const a = await seed();
    await t
      .owner()
      .query(`UPDATE identity.admin_role_assignments SET revoked_at = now() WHERE user_id = $1`, [
        a.requester,
      ]);
    expect(await status(consume({ id: a.id, subject: a.subject, by: a.requester }))).toBe(403);
    const never = await seed({ requesterRole: null });
    expect(await status(consume({ id: never.id, subject: never.subject, by: never.requester }))).toBe(403);
  });

  it('refuses the wrong action, the wrong subject and an unknown id', async () => {
    const a = await seed();
    const other = await seed();
    expect(
      await status(consume({ id: a.id, action: 'LARGE_REFUND', subject: a.subject, by: a.requester })),
    ).toBe(404);
    expect(await status(consume({ id: a.id, subject: other.subject, by: a.requester }))).toBe(404);
    expect(
      await status(
        consume({ id: '0190a6e0-0000-7000-8000-000000000000', subject: a.subject, by: a.requester }),
      ),
    ).toBe(404);
  });

  it('refuses an unapproved, a rejected and an expired approval', async () => {
    const unapproved = await seed({ approved: false });
    const rejected = await seed({ approved: false, rejected: true });
    const expired = await seed({ expired: true });
    expect(
      await status(consume({ id: unapproved.id, subject: unapproved.subject, by: unapproved.requester })),
    ).toBe(403);
    expect(
      await status(consume({ id: rejected.id, subject: rejected.subject, by: rejected.requester })),
    ).toBe(403);
    expect(await status(consume({ id: expired.id, subject: expired.subject, by: expired.requester }))).toBe(
      409,
    );
  });

  it('lets exactly one of two concurrent consumers win', async () => {
    const a = await seed();
    const results = await Promise.all([
      status(consume({ id: a.id, subject: a.subject, by: a.requester })),
      status(consume({ id: a.id, subject: a.subject, by: a.requester })),
    ]);
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
    expect(results.filter((result) => result === 409)).toHaveLength(1);
  });

  it('derives the state a list shows', () => {
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

  const withFacts = async (merchant: string | null, userStatus = 'ACTIVE') => {
    const { userId } = await seedUser(t.app(), { status: userStatus });
    if (merchant) {
      await t
        .owner()
        .query(
          `INSERT INTO identity.user_capabilities (user_id, capability, status) VALUES ($1, 'MERCHANT', $2::identity.capability_status)`,
          [userId, merchant],
        );
    }
    return userId;
  };

  it('reads the real tables: false only for an ACTIVE merchant or a user who is not ACTIVE', async () => {
    const service = createCapabilityService({ facts: postgresBuyerFacts(t.db()) });
    expect(await service.canActAsBuyer(await withFacts(null))).toBe(true);
    expect(await service.canActAsBuyer(await withFacts('PENDING'))).toBe(true);
    expect(await service.canActAsBuyer(await withFacts('ACTIVE'))).toBe(true);
    expect(await service.canActAsBuyer(await withFacts('SUSPENDED'))).toBe(true);
    expect(await service.canActAsBuyer(await withFacts('REVOKED'))).toBe(true);
    expect(await service.canActAsBuyer(await withFacts(null, 'SUSPENDED'))).toBe(false);
    expect(await service.canActAsBuyer(await withFacts(null, 'RESTRICTED'))).toBe(false);
  });

  it('reports the raw facts, and a missing user as no status at all', async () => {
    const facts = postgresBuyerFacts(t.db());
    expect(await facts(await withFacts('ACTIVE'))).toEqual({
      userStatus: 'ACTIVE',
      merchantStatus: 'ACTIVE',
    });
    expect(await facts('0190a6e0-0000-7000-8000-000000000000')).toEqual({
      userStatus: null,
      merchantStatus: null,
    });
  });
});
