// T-037: separation of duties at the permission layer. Pure functions, so the whole of M1 C5 and
// section 12.3's footnotes are exercised without a database.
import { describe, expect, it } from 'vitest';
import {
  DUAL_APPROVAL_ROLES,
  approvalSatisfies,
  MAX_ROLE_GRANT_DAYS,
  TWO_STEP_ACTIONS,
  authorizeAdminAction,
  needsApproval,
  twoStepActionFor,
  validateRoleGrant,
  type ApprovalProof,
} from '../../../../../src/modules/identity/domain/rbac/sod.js';
import { PERMISSION_CODES, ROLES } from '../../../../../src/modules/identity/domain/rbac/catalog.js';

const trade = {
  tradePartyUserIds: ['buyer-user', 'seller-user'],
  sharesDeviceWithActor: false,
  sharesPayoutInstrumentWithActor: false,
};

const approval = (overrides: Partial<ApprovalProof> = {}): ApprovalProof => ({
  approvedByUserId: 'approver-user',
  approvedByRoles: ['OPERATIONS_ADMIN'],
  identityChallengeConfirmed: true,
  ...overrides,
});

describe('authorizeAdminAction: permission', () => {
  it('denies a role without the permission and an unknown permission', () => {
    expect(
      authorizeAdminAction({ actorUserId: 'staff', roles: ['READ_ONLY'], permission: 'user.suspend' }),
    ).toEqual({ allowed: false, reason: 'PERMISSION_DENIED' });
    expect(
      authorizeAdminAction({ actorUserId: 'staff', roles: ['SUPER_ADMIN'], permission: 'trade.refund' }),
    ).toEqual({ allowed: false, reason: 'PERMISSION_DENIED' });
    expect(authorizeAdminAction({ actorUserId: 'staff', roles: [], permission: 'user.view' })).toEqual({
      allowed: false,
      reason: 'PERMISSION_DENIED',
    });
  });

  it('allows a plain grant, and unions every role the actor holds', () => {
    expect(
      authorizeAdminAction({
        actorUserId: 'staff',
        roles: ['READ_ONLY', 'FRAUD_ANALYST'],
        permission: 'user.restrict',
        subjectUserId: 'someone',
      }),
    ).toEqual({ allowed: true });
  });
});

describe('authorizeAdminAction: self-action', () => {
  it('blocks a destructive action on the actor’s own account', () => {
    expect(
      authorizeAdminAction({
        actorUserId: 'staff',
        roles: ['OPERATIONS_ADMIN'],
        permission: 'user.suspend',
        subjectUserId: 'staff',
      }),
    ).toEqual({ allowed: false, reason: 'SELF_ACTION' });
  });

  it('does not block a read on the actor’s own account', () => {
    expect(
      authorizeAdminAction({
        actorUserId: 'staff',
        roles: ['OPERATIONS_ADMIN'],
        permission: 'user.view',
        subjectUserId: 'staff',
      }),
    ).toEqual({ allowed: true });
  });
});

describe('authorizeAdminAction: self-dealing on a trade (M1 C5)', () => {
  it.each([
    { ...trade, tradePartyUserIds: ['staff-user', 'seller-user'] },
    { ...trade, sharesDeviceWithActor: true },
    { ...trade, sharesPayoutInstrumentWithActor: true },
  ])('denies a permitted action when the actor is connected to the trade: %o', (context) => {
    expect(
      authorizeAdminAction({
        actorUserId: 'staff-user',
        roles: ['OPERATIONS_ADMIN'],
        permission: 'trade.dispute_escalate',
        trade: context,
      }),
    ).toEqual({ allowed: false, reason: 'SELF_DEALING' });
  });

  it('allows it when no conflict exists', () => {
    expect(
      authorizeAdminAction({
        actorUserId: 'staff-user',
        roles: ['OPERATIONS_ADMIN'],
        permission: 'trade.dispute_escalate',
        trade,
      }),
    ).toEqual({ allowed: true });
  });

  it('still blocks it for an actor holding a role that would otherwise approve', () => {
    expect(
      authorizeAdminAction({
        actorUserId: 'staff-user',
        roles: ['DISPUTE_REVIEWER'],
        permission: 'dispute.decide',
        trade: { ...trade, tradePartyUserIds: ['staff-user'] },
      }),
    ).toEqual({ allowed: false, reason: 'SELF_DEALING' });
  });
});

describe('authorizeAdminAction: two-step actions', () => {
  const request = {
    actorUserId: 'staff-user',
    roles: ['OPERATIONS_ADMIN'],
    permission: 'mfa.reset',
    subjectUserId: 'subject-user',
  };

  it('refuses without an approval', () => {
    expect(authorizeAdminAction(request)).toEqual({ allowed: false, reason: 'APPROVAL_REQUIRED' });
  });

  it.each([
    ['the requester approving their own request', approval({ approvedByUserId: 'staff-user' })],
    ['the subject approving their own reset', approval({ approvedByUserId: 'subject-user' })],
    ['no identity challenge', approval({ identityChallengeConfirmed: false })],
    ['an approver who does not hold the permission', approval({ approvedByRoles: ['READ_ONLY'] })],
    ['an approver with no roles', approval({ approvedByRoles: [] })],
  ])('refuses %s', (_name, proof) => {
    expect(authorizeAdminAction({ ...request, approval: proof })).toEqual({
      allowed: false,
      reason: 'APPROVAL_REQUIRED',
    });
  });

  it('accepts a distinct, challenged approver who holds the permission', () => {
    expect(authorizeAdminAction({ ...request, approval: approval() })).toEqual({ allowed: true });
    expect(
      authorizeAdminAction({ ...request, approval: approval({ approvedByRoles: ['SUPPORT_LEAD'] }) }),
    ).toEqual({ allowed: true });
  });

  it('treats a forced username change as two-step although its grant is unconditional', () => {
    const forced = { ...request, roles: ['FRAUD_ANALYST'], permission: 'username.force_change' };
    expect(authorizeAdminAction(forced)).toEqual({ allowed: false, reason: 'APPROVAL_REQUIRED' });
    expect(
      authorizeAdminAction({ ...forced, approval: approval({ approvedByRoles: ['OPERATIONS_ADMIN'] }) }),
    ).toEqual({ allowed: true });
  });

  it('asks for the identity challenge only where the registry does (MFA reset, note 3)', () => {
    const unchallenged = approval({ identityChallengeConfirmed: false });
    expect(authorizeAdminAction({ ...request, approval: unchallenged })).toEqual({
      allowed: false,
      reason: 'APPROVAL_REQUIRED',
    });
    expect(
      authorizeAdminAction({
        ...request,
        roles: ['FRAUD_ANALYST'],
        permission: 'username.force_change',
        approval: unchallenged,
      }),
    ).toEqual({ allowed: true });
    expect(TWO_STEP_ACTIONS.MFA_RESET.identityChallenge).toBe(true);
  });

  it('checks self-dealing even when the approval is valid', () => {
    expect(
      authorizeAdminAction({
        ...request,
        permission: 'trade.cancel_override',
        approval: approval(),
        trade: { ...trade, tradePartyUserIds: ['staff-user'] },
      }),
    ).toEqual({ allowed: false, reason: 'SELF_DEALING' });
  });
});

describe('authorizeAdminAction: the section 12.3 footnote conditions', () => {
  const base = { actorUserId: 'agent', subjectUserId: 'customer' };

  it('footnote 1: unmasking PII needs an open ticket on that user', () => {
    const pii = { ...base, roles: ['SUPPORT_AGENT'], permission: 'user.view_pii' };
    expect(authorizeAdminAction(pii)).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
    expect(authorizeAdminAction({ ...pii, ticket: { open: false, referencesSubject: true } })).toEqual({
      allowed: false,
      reason: 'CONDITION_NOT_MET',
    });
    expect(authorizeAdminAction({ ...pii, ticket: { open: true, referencesSubject: false } })).toEqual({
      allowed: false,
      reason: 'CONDITION_NOT_MET',
    });
    expect(authorizeAdminAction({ ...pii, ticket: { open: true, referencesSubject: true } })).toEqual({
      allowed: true,
    });
  });

  it('footnote 1 does not apply to a role that holds the permission outright', () => {
    expect(
      authorizeAdminAction({
        ...base,
        roles: ['SUPPORT_AGENT', 'FRAUD_ANALYST'],
        permission: 'user.view_pii',
      }),
    ).toEqual({ allowed: true });
  });

  it('footnote 4: SUPPORT_LEAD closes only on a documented user request', () => {
    const close = { ...base, roles: ['SUPPORT_LEAD'], permission: 'user.close' };
    expect(authorizeAdminAction(close)).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
    expect(authorizeAdminAction({ ...close, ticket: { open: true, referencesSubject: true } })).toEqual({
      allowed: false,
      reason: 'CONDITION_NOT_MET',
    });
    expect(
      authorizeAdminAction({
        ...close,
        ticket: { open: true, referencesSubject: true, documentedUserRequest: true },
      }),
    ).toEqual({ allowed: true });
  });

  it('footnote 2: impersonation is allowed only inside a read-only, time-boxed session', () => {
    const view = { ...base, roles: ['SUPER_ADMIN'], permission: 'user.impersonate' };
    expect(authorizeAdminAction(view)).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
    expect(authorizeAdminAction({ ...view, readOnlyTimeBoxed: true })).toEqual({ allowed: true });
  });
});

describe('the two-step registry', () => {
  it('names the four actions the ticket lists, each with a catalogued permission', () => {
    expect(Object.keys(TWO_STEP_ACTIONS).sort()).toEqual([
      'LARGE_REFUND',
      'MFA_RESET',
      'USERNAME_FORCE_CHANGE',
      'VERIFICATION_OVERRIDE',
    ]);
    for (const { permission } of Object.values(TWO_STEP_ACTIONS))
      expect(PERMISSION_CODES as readonly string[]).toContain(permission);
    expect(twoStepActionFor('mfa.reset')).toBe('MFA_RESET');
    expect(twoStepActionFor('user.view')).toBeUndefined();
  });

  it('marks every approval-conditional grant as needing approval', () => {
    for (const permission of [
      'mfa.reset',
      'payment.refund',
      'verification.override',
      'trade.cancel_override',
    ])
      expect(needsApproval(permission)).toBe(true);
    expect(needsApproval('username.force_change')).toBe(true);
    expect(needsApproval('user.view')).toBe(false);
  });
});

describe('approvalSatisfies', () => {
  it('is what the approval service asks, apart from the permission check on the requester', () => {
    const input = { permission: 'mfa.reset' as const, requesterUserId: 'a', subjectUserId: 's' };
    expect(approvalSatisfies({ ...input, proof: approval() })).toBe(true);
    expect(approvalSatisfies({ ...input })).toBe(false);
    expect(approvalSatisfies({ ...input, proof: approval({ approvedByUserId: 'a' }) })).toBe(false);
    expect(approvalSatisfies({ ...input, proof: approval({ approvedByUserId: 's' }) })).toBe(false);
  });
});

describe('role grants', () => {
  it('needs dual approval for exactly FINANCE_ADMIN, SUPER_ADMIN and COMPLIANCE_OFFICER', () => {
    expect([...DUAL_APPROVAL_ROLES].sort()).toEqual(['COMPLIANCE_OFFICER', 'FINANCE_ADMIN', 'SUPER_ADMIN']);
    expect(ROLES.filter((r) => r.requiresDualApproval).map((r) => r.code)).toEqual(
      ROLES.map((r) => r.code).filter((code) => DUAL_APPROVAL_ROLES.includes(code)),
    );
  });

  const now = new Date('2026-11-06T10:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const grant = {
    roleCode: 'KYC_ANALYST',
    userId: 'grantee',
    grantedBy: 'grantor',
    now,
  };

  it('accepts a permanent grant of an ordinary role and a time-boxed one', () => {
    expect(validateRoleGrant(grant)).toEqual({ ok: true, needsSecondApprover: false });
    expect(validateRoleGrant({ ...grant, expiresAt: new Date(now.getTime() + 30 * day) })).toEqual({
      ok: true,
      needsSecondApprover: false,
    });
  });

  it('rejects an expiry in the past, at now, or beyond the horizon', () => {
    for (const expiresAt of [
      new Date(now.getTime() - day),
      now,
      new Date(now.getTime() + (MAX_ROLE_GRANT_DAYS + 1) * day),
    ])
      expect(validateRoleGrant({ ...grant, expiresAt })).toEqual({ ok: false, reason: 'INVALID_EXPIRY' });
  });

  it('rejects granting a role to oneself', () => {
    expect(validateRoleGrant({ ...grant, userId: 'grantor' })).toEqual({ ok: false, reason: 'SELF_GRANT' });
  });

  it('rejects an unknown role', () => {
    expect(validateRoleGrant({ ...grant, roleCode: 'GOD_MODE' })).toEqual({
      ok: false,
      reason: 'UNKNOWN_ROLE',
    });
  });

  it.each(['FINANCE_ADMIN', 'SUPER_ADMIN', 'COMPLIANCE_OFFICER'])(
    'flags %s as needing a second approver, who must be a third person',
    (roleCode) => {
      expect(validateRoleGrant({ ...grant, roleCode })).toEqual({ ok: true, needsSecondApprover: true });
      expect(validateRoleGrant({ ...grant, roleCode, approvedBy: 'approver' })).toEqual({
        ok: true,
        needsSecondApprover: false,
      });
      for (const approvedBy of ['grantor', 'grantee'])
        expect(validateRoleGrant({ ...grant, roleCode, approvedBy })).toEqual({
          ok: false,
          reason: 'APPROVER_NOT_DISTINCT',
        });
    },
  );
});
