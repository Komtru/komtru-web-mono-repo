// The permission codes the console knows, copied from the T-037 catalogue
// (`apps/backend-api/src/modules/identity/domain/rbac/catalog.ts`, M1 section 12.2).
//
// A copy, not an import: the console is a browser bundle and the catalogue lives in the backend
// workspace. `test/nav.test.ts` reads the catalogue file and fails when this list and it differ, so
// a permission added there without being added here is a red test rather than a nav item that can
// never show.
export const PERMISSION_CODES = [
  'user.view',
  'user.view_pii',
  'user.search',
  'user.update',
  'user.restrict',
  'user.suspend',
  'user.reinstate',
  'user.close',
  'user.impersonate',
  'username.reserve',
  'username.force_change',
  'session.view',
  'session.revoke',
  'mfa.reset',
  'credential.force_reset',
  'role.view',
  'role.grant',
  'role.revoke',
  'audit.view',
  'audit.export',
  'capability.grant',
  'capability.revoke',
  'trade.view',
  'trade.view_all',
  'trade.cancel_override',
  'trade.dispute_escalate',
  'payment.view',
  'payment.refund',
  'payout.view',
  'payout.retry',
  'reconciliation.view',
  'reconciliation.resolve',
  'dispute.view',
  'dispute.submit_evidence',
  'dispute.assign',
  'dispute.decide',
  'dispute.appeal',
  'dispute.decide_appeal',
  'verification.view',
  'verification.review',
  'verification.override',
  'duplicate_flag.view',
  'duplicate_flag.resolve',
  'provider_call.view',
  'ticket.view',
  'ticket.assign',
  'ticket.resolve',
  'ticket.reassign',
  'ticket.escalate_to_dispute',
  'geo.manage',
  'merchant.application.view',
  'merchant.application.decide',
  'risk.view',
  'risk.resolve',
  'logistics.manage',
  'park.view',
  'park.manage',
  'cases.view',
  'cases.manage',
  'config.view',
  'config.manage',
  'compliance.view',
  'compliance.dsr_fulfill',
  'compliance.retention_manage',
  'analytics.view',
  'analytics.run_report',
  'growth.view',
  'growth.manage',
  'moderation.view',
  'moderation.act',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

const KNOWN = new Set<string>(PERMISSION_CODES);

export const isPermissionCode = (value: string): value is PermissionCode => KNOWN.has(value);

/**
 * What the platform said someone holds, narrowed to codes the console knows. A code it does not
 * know is dropped rather than trusted: a nav item is shown for a permission it can name, and
 * nothing else.
 */
export const permissionSet = (codes: readonly string[]): ReadonlySet<PermissionCode> =>
  new Set(codes.filter(isPermissionCode));
