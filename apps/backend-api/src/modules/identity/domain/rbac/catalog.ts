// M1 §12: the one permission catalogue for the whole platform.
//
// This is what the `permission` string on `defineRoute` means. Deny by default — a blank cell in
// M1 §12.3 is a hard no, including for SUPER_ADMIN, and nothing is implicit anywhere.
//
// The matrix is typed `Record<PermissionCode, Record<RoleCode, Grant>>` with no `Partial`, so a
// permission added to PERMISSION_CODES without a row, or a role added without a column, is a
// compile error rather than a silent deny. test/modules/identity/domain/rbac/matrix.test.ts then
// re-derives every cell from M1 §12.3's own table and asserts CATALOGUE_COUNTS.
//
// T-037 widened it from M1's 22 identity permissions to every module's slice (trade, payment,
// payout, reconciliation, dispute, verification, duplicate flag, ticket, risk, logistics, park,
// cases, config, compliance, analytics, growth, messaging moderation), added the `DISPUTE_LEAD` and
// `PARK_OPERATIONS` roles, `geo.manage` and `merchant.application.view` / `.decide`. Where a module
// spec names a permission but not who holds it, the grant is the narrowest one that lets the role
// the spec describes do its job; those choices are listed in the T-037 plan as open questions. Every
// change here must update CATALOGUE_COUNTS and the table in the matrix test in the same commit.

/** M1 §12.1 in the spec's order, with M3's `DISPUTE_LEAD` and the owner-nameable `PARK_OPERATIONS` beside their neighbours. */
export const ROLE_CODES = [
  'SUPER_ADMIN',
  'OPERATIONS_ADMIN',
  'FINANCE_ADMIN',
  'COMPLIANCE_OFFICER',
  'FRAUD_ANALYST',
  'KYC_ANALYST',
  'DISPUTE_REVIEWER',
  'DISPUTE_LEAD',
  'SUPPORT_AGENT',
  'SUPPORT_LEAD',
  'LOGISTICS_OPERATOR',
  'PARK_OPERATIONS',
  'ANALYST',
  'READ_ONLY',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  /** Every M1 §12.1 role is a staff role; capabilities (MERCHANT, …) are a different axis. */
  isStaffRole: true;
  requiresDualApproval: boolean;
}

export const ROLES: readonly RoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super admin',
    description: 'Break-glass. Two people maximum.',
    isStaffRole: true,
    requiresDualApproval: true,
  },
  {
    code: 'OPERATIONS_ADMIN',
    name: 'Operations admin',
    description: 'Day-to-day trade and user operations.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'FINANCE_ADMIN',
    name: 'Finance admin',
    description: 'Refunds, settlement, reconciliation.',
    isStaffRole: true,
    requiresDualApproval: true,
  },
  {
    code: 'COMPLIANCE_OFFICER',
    name: 'Compliance officer',
    description: 'NDPA, regulatory reporting, erasure approval.',
    isStaffRole: true,
    requiresDualApproval: true,
  },
  {
    code: 'FRAUD_ANALYST',
    name: 'Fraud analyst',
    description: 'Investigation, restriction, device graph.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'KYC_ANALYST',
    name: 'KYC analyst',
    description: 'Verification review.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'DISPUTE_REVIEWER',
    name: 'Dispute reviewer',
    description: 'Dispute decisions.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'DISPUTE_LEAD',
    name: 'Dispute lead',
    description: 'Dispute assignment and appeal decisions (M3).',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'SUPPORT_AGENT',
    name: 'Support agent',
    description: 'Tickets, limited user view.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'SUPPORT_LEAD',
    name: 'Support lead',
    description: 'Support, escalation and reassignment.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'LOGISTICS_OPERATOR',
    name: 'Logistics operator',
    description: 'Shipment exceptions.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'PARK_OPERATIONS',
    name: 'Park operations',
    description: 'Park network administration and custody (TrustOps).',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'ANALYST',
    name: 'Analyst',
    description: 'Read-only analytics, no PII.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
  {
    code: 'READ_ONLY',
    name: 'Read only',
    description: 'Audit and observer access.',
    isStaffRole: true,
    requiresDualApproval: false,
  },
] as const;

/** M1 §12.2, in the spec's reading order. */
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

export interface PermissionDefinition {
  code: PermissionCode;
  /** The part before the dot; `permissions.domain` in the schema. */
  domain: string;
  action: string;
  description: string;
  /** Touches money directly. Nothing in the identity slice does except taking the log off-platform. */
  isFinancial: boolean;
  /** Removes access, ends a session, or changes what someone else can do. */
  isDestructive: boolean;
}

const permission = (
  code: PermissionCode,
  description: string,
  flags: { financial?: boolean; destructive?: boolean } = {},
): PermissionDefinition => {
  const dot = code.indexOf('.');
  return {
    code,
    domain: code.slice(0, dot),
    action: code.slice(dot + 1),
    description,
    isFinancial: flags.financial ?? false,
    isDestructive: flags.destructive ?? false,
  };
};

export const PERMISSIONS: readonly PermissionDefinition[] = [
  permission('user.view', 'Read a user record without personal data.'),
  permission('user.view_pii', 'Reveal a user’s personal data.'),
  permission('user.search', 'Search the user directory.'),
  permission('user.update', 'Edit a user record.'),
  permission('user.restrict', 'Restrict a user’s activity.', { destructive: true }),
  permission('user.suspend', 'Suspend a user.', { destructive: true }),
  permission('user.reinstate', 'Lift a restriction or suspension.'),
  permission('user.close', 'Close a user account.', { destructive: true }),
  permission('user.impersonate', 'View the platform as a user.', { destructive: true }),
  permission('username.reserve', 'Add a handle to the reserved namespace.'),
  permission('username.force_change', 'Force a user’s handle to change.', { destructive: true }),
  permission('session.view', 'List a user’s sessions.'),
  permission('session.revoke', 'Revoke a user’s sessions.', { destructive: true }),
  permission('mfa.reset', 'Reset a user’s MFA factors.', { destructive: true }),
  permission('credential.force_reset', 'Force a password reset.', { destructive: true }),
  permission('role.view', 'List staff role assignments.'),
  permission('role.grant', 'Grant a staff role.', { destructive: true }),
  permission('role.revoke', 'Revoke a staff role.', { destructive: true }),
  permission('audit.view', 'Read the audit log.'),
  // Financial: an exported audit log leaves the platform's controls, and it is the artefact a
  // regulator or an auditor is handed.
  permission('audit.export', 'Export the audit log.', { financial: true }),
  permission('capability.grant', 'Grant an account capability.'),
  permission('capability.revoke', 'Revoke an account capability.', { destructive: true }),
  permission('trade.view', 'Read trades in the role’s assigned scope.'),
  permission('trade.view_all', 'Read any trade, not only one in scope.'),
  permission('trade.cancel_override', 'Force-cancel a trade.', { destructive: true }),
  permission('trade.dispute_escalate', 'Pull a trade into dispute review early.'),
  permission('payment.view', 'Read payment details.'),
  permission('payment.refund', 'Issue a refund.', { financial: true, destructive: true }),
  permission('payout.view', 'Read payout details.'),
  permission('payout.retry', 'Retry a failed payout.', { financial: true }),
  permission('reconciliation.view', 'Read reconciliation runs.'),
  permission('reconciliation.resolve', 'Resolve a reconciliation discrepancy.', { financial: true }),
  permission('dispute.view', 'Read dispute cases.'),
  permission('dispute.submit_evidence', 'Submit evidence to a dispute the caller is a party to.'),
  permission('dispute.assign', 'Assign a dispute to a reviewer.'),
  permission('dispute.decide', 'Decide a dispute.', { destructive: true }),
  permission('dispute.appeal', 'Appeal a dispute the caller is a party to.'),
  permission('dispute.decide_appeal', 'Decide a dispute appeal.', { destructive: true }),
  permission('verification.view', 'Read verification cases.'),
  permission('verification.review', 'Act on the verification review queue.'),
  permission('verification.override', 'Grant or revoke a level outside the provider flow.', {
    destructive: true,
  }),
  permission('duplicate_flag.view', 'Read duplicate-identity flags.'),
  permission('duplicate_flag.resolve', 'Resolve a duplicate-identity flag.'),
  permission('provider_call.view', 'Read provider-call metadata, never personal data.'),
  permission('ticket.view', 'Read support tickets.'),
  permission('ticket.assign', 'Assign a support ticket.'),
  permission('ticket.resolve', 'Resolve a support ticket.'),
  permission('ticket.reassign', 'Move a ticket between agents.'),
  permission('ticket.escalate_to_dispute', 'Escalate a ticket into dispute review.'),
  permission('geo.manage', 'Add, rename and deactivate cities and review city requests.', {
    destructive: true,
  }),
  permission('merchant.application.view', 'Read merchant applications.'),
  permission('merchant.application.decide', 'Approve or reject a merchant application.', {
    destructive: true,
  }),
  permission('risk.view', 'Read the fraud review queue.'),
  permission('risk.resolve', 'Assign and resolve fraud review items.', { destructive: true }),
  permission('logistics.manage', 'Manage logistics companies, members and packages.'),
  permission('park.view', 'Read the Park network.'),
  permission('park.manage', 'Administer Park hubs and agents.', { destructive: true }),
  permission('cases.view', 'Read cases.'),
  permission('cases.manage', 'Work and close cases.'),
  permission('config.view', 'Read platform configuration.'),
  permission('config.manage', 'Change platform configuration and feature flags.', { destructive: true }),
  permission('compliance.view', 'Read compliance records and the compliance access log.'),
  permission('compliance.dsr_fulfill', 'Fulfil a data-subject request.', { destructive: true }),
  permission('compliance.retention_manage', 'Change a retention policy.', { destructive: true }),
  permission('analytics.view', 'Read analytics dashboards and metrics.'),
  permission('analytics.run_report', 'Run a report on demand.'),
  permission('growth.view', 'Read referral and promo data.'),
  permission('growth.manage', 'Manage promo codes and referral rules.'),
  permission('moderation.view', 'Read moderation reports.'),
  permission('moderation.act', 'Act on a moderation report.', { destructive: true }),
] as const;

/**
 * The M1 §12.3 footnotes, as machine-readable conditions.
 *
 * A conditional grant IS a grant — the role holds the permission and gets a `role_permissions` row.
 * The condition says what the service layer must additionally prove before the action runs, and
 * T-037 owns that enforcement.
 */
export type GrantCondition =
  /** ¹ Masked by default; unmasking needs an open ticket on that user, is time-boxed to the ticket, and audits per field. */
  | 'TICKET_SCOPED_PII'
  /** ² Read-only, 15 minutes, banner-visible, no trade/payment/settings mutation. */
  | 'READ_ONLY_TIME_BOXED'
  /** ³ Two-step via `admin_action_approvals`: a different holder approves, after an identity challenge. */
  | 'ADMIN_ACTION_APPROVAL'
  /** ⁴ Only on a documented user request in an open ticket. */
  | 'DOCUMENTED_USER_REQUEST';

export type Grant = 'DENY' | 'ALLOW' | { allow: true; condition: GrantCondition };

type MatrixRow = Readonly<Record<RoleCode, Grant>>;

const all = (grant: Grant): MatrixRow => ({
  SUPER_ADMIN: grant,
  OPERATIONS_ADMIN: grant,
  FINANCE_ADMIN: grant,
  COMPLIANCE_OFFICER: grant,
  FRAUD_ANALYST: grant,
  KYC_ANALYST: grant,
  DISPUTE_REVIEWER: grant,
  DISPUTE_LEAD: grant,
  SUPPORT_AGENT: grant,
  SUPPORT_LEAD: grant,
  LOGISTICS_OPERATOR: grant,
  PARK_OPERATIONS: grant,
  ANALYST: grant,
  READ_ONLY: grant,
});

/**
 * Written as "deny everything, then name the holders", so a reader checks a short list of names
 * against M1 §12.3 rather than counting fourteen values per row. The exhaustive matrix test compares
 * the result against the spec's table cell by cell either way.
 */
const row = (grants: Partial<Record<RoleCode, Grant>>): MatrixRow => ({ ...all('DENY'), ...grants });

const PII_UNMASK: Grant = { allow: true, condition: 'TICKET_SCOPED_PII' };
const APPROVED_ACTION: Grant = { allow: true, condition: 'ADMIN_ACTION_APPROVAL' };

/** Every listed role holds the permission outright. */
const allow = (...roles: RoleCode[]): MatrixRow =>
  row(Object.fromEntries(roles.map((role) => [role, 'ALLOW' as const])));

/** Every listed role holds it, but acting needs a second holder's approval (M1 §12.3 note 3). */
const approved = (...roles: RoleCode[]): MatrixRow =>
  row(Object.fromEntries(roles.map((role) => [role, APPROVED_ACTION])));

export const PERMISSION_MATRIX: Readonly<Record<PermissionCode, MatrixRow>> = {
  'user.view': all('ALLOW'),
  'user.search': all('ALLOW'),
  'user.view_pii': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
    KYC_ANALYST: 'ALLOW',
    DISPUTE_REVIEWER: 'ALLOW',
    SUPPORT_AGENT: PII_UNMASK,
    SUPPORT_LEAD: PII_UNMASK,
  }),
  'user.update': row({ SUPER_ADMIN: 'ALLOW', OPERATIONS_ADMIN: 'ALLOW' }),
  'user.restrict': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
  }),
  'user.suspend': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
  }),
  'user.reinstate': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
  }),
  'user.close': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    SUPPORT_LEAD: { allow: true, condition: 'DOCUMENTED_USER_REQUEST' },
  }),
  'user.impersonate': row({ SUPER_ADMIN: { allow: true, condition: 'READ_ONLY_TIME_BOXED' } }),
  'username.reserve': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
  }),
  'username.force_change': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
  }),
  'session.view': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
    SUPPORT_AGENT: 'ALLOW',
    SUPPORT_LEAD: 'ALLOW',
    READ_ONLY: 'ALLOW',
  }),
  'session.revoke': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
    SUPPORT_AGENT: 'ALLOW',
    SUPPORT_LEAD: 'ALLOW',
  }),
  'mfa.reset': row({
    SUPER_ADMIN: APPROVED_ACTION,
    OPERATIONS_ADMIN: APPROVED_ACTION,
    SUPPORT_LEAD: APPROVED_ACTION,
  }),
  'credential.force_reset': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
    SUPPORT_LEAD: 'ALLOW',
  }),
  'capability.grant': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    KYC_ANALYST: 'ALLOW',
  }),
  'capability.revoke': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
    KYC_ANALYST: 'ALLOW',
  }),
  'role.view': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
    SUPPORT_LEAD: 'ALLOW',
    READ_ONLY: 'ALLOW',
  }),
  'role.grant': row({ SUPER_ADMIN: 'ALLOW' }),
  // §12.3 note 5: compliance may revoke but never grant. That is the offboarding path, and denying
  // the grant is what stops compliance escalating its own access.
  'role.revoke': row({ SUPER_ADMIN: 'ALLOW', COMPLIANCE_OFFICER: 'ALLOW' }),
  'audit.view': row({
    SUPER_ADMIN: 'ALLOW',
    OPERATIONS_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
    FRAUD_ANALYST: 'ALLOW',
    DISPUTE_REVIEWER: 'ALLOW',
    SUPPORT_LEAD: 'ALLOW',
    READ_ONLY: 'ALLOW',
  }),
  'audit.export': row({
    SUPER_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    COMPLIANCE_OFFICER: 'ALLOW',
  }),
  // M7 §8.
  'trade.view': allow(
    'SUPER_ADMIN',
    'OPERATIONS_ADMIN',
    'DISPUTE_REVIEWER',
    'DISPUTE_LEAD',
    'SUPPORT_AGENT',
    'SUPPORT_LEAD',
  ),
  'trade.view_all': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN'),
  'trade.cancel_override': approved('SUPER_ADMIN', 'OPERATIONS_ADMIN'),
  'trade.dispute_escalate': allow('OPERATIONS_ADMIN', 'DISPUTE_REVIEWER'),
  // M8 §10. A refund is a financial action routed through admin_action_approvals; the spec sets no
  // "large" threshold, so every refund is two-step.
  'payment.view': allow('FINANCE_ADMIN'),
  'payment.refund': approved('FINANCE_ADMIN'),
  'payout.view': allow('FINANCE_ADMIN'),
  'payout.retry': allow('FINANCE_ADMIN'),
  'reconciliation.view': allow('FINANCE_ADMIN'),
  'reconciliation.resolve': allow('FINANCE_ADMIN'),
  // M3 §8. The two party permissions belong to the buyer and seller on their own dispute, not to
  // staff, so no staff role holds them; they are catalogued so the route layer has a name to check.
  'dispute.view': allow(
    'SUPER_ADMIN',
    'OPERATIONS_ADMIN',
    'DISPUTE_REVIEWER',
    'DISPUTE_LEAD',
    'SUPPORT_LEAD',
  ),
  'dispute.submit_evidence': row({}),
  'dispute.assign': allow('DISPUTE_LEAD'),
  'dispute.decide': allow('DISPUTE_REVIEWER'),
  'dispute.appeal': row({}),
  'dispute.decide_appeal': allow('DISPUTE_LEAD'),
  // M6 §10.
  'verification.view': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'KYC_ANALYST'),
  'verification.review': allow('KYC_ANALYST'),
  'verification.override': approved('SUPER_ADMIN', 'KYC_ANALYST'),
  'duplicate_flag.view': allow('KYC_ANALYST'),
  'duplicate_flag.resolve': allow('KYC_ANALYST'),
  'provider_call.view': allow('SUPER_ADMIN', 'KYC_ANALYST'),
  // M10 §7.
  'ticket.view': allow('SUPPORT_AGENT', 'SUPPORT_LEAD'),
  'ticket.assign': allow('SUPPORT_AGENT', 'SUPPORT_LEAD'),
  'ticket.resolve': allow('SUPPORT_AGENT', 'SUPPORT_LEAD'),
  'ticket.reassign': allow('SUPPORT_LEAD'),
  'ticket.escalate_to_dispute': allow('SUPPORT_AGENT', 'SUPPORT_LEAD'),
  // T-037 names these two by holder; geo.manage has no named holder in any spec.
  'geo.manage': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN'),
  'merchant.application.view': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'KYC_ANALYST'),
  'merchant.application.decide': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'KYC_ANALYST'),
  // M13 admin surface; the manual restriction endpoints reuse user.restrict.
  'risk.view': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'COMPLIANCE_OFFICER', 'FRAUD_ANALYST'),
  'risk.resolve': allow('SUPER_ADMIN', 'FRAUD_ANALYST'),
  // m2 §5a: stated by the spec as SUPER_ADMIN, OPERATIONS_ADMIN and LOGISTICS_OPERATOR.
  'logistics.manage': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'LOGISTICS_OPERATOR'),
  // Design §7: Park network administration is TrustOps staff, `park.*`.
  'park.view': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'PARK_OPERATIONS'),
  'park.manage': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'PARK_OPERATIONS'),
  'cases.view': allow(
    'SUPER_ADMIN',
    'OPERATIONS_ADMIN',
    'COMPLIANCE_OFFICER',
    'FRAUD_ANALYST',
    'KYC_ANALYST',
    'PARK_OPERATIONS',
  ),
  'cases.manage': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'PARK_OPERATIONS'),
  // M17: the one slice where the cost of a wrong change is platform-wide, so only SUPER_ADMIN writes.
  'config.view': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN'),
  'config.manage': allow('SUPER_ADMIN'),
  // M15: erasure approval and regulatory reporting are COMPLIANCE_OFFICER's by M1 §12.1.
  'compliance.view': allow('SUPER_ADMIN', 'COMPLIANCE_OFFICER'),
  'compliance.dsr_fulfill': allow('COMPLIANCE_OFFICER'),
  'compliance.retention_manage': allow('COMPLIANCE_OFFICER'),
  // M16. ANALYST is read-only by M1 §12.1, so it can look but not trigger a run.
  'analytics.view': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'ANALYST', 'READ_ONLY'),
  'analytics.run_report': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN'),
  // M18.
  'growth.view': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'ANALYST'),
  'growth.manage': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN'),
  // M11 moderation.
  'moderation.view': allow(
    'SUPER_ADMIN',
    'OPERATIONS_ADMIN',
    'FRAUD_ANALYST',
    'SUPPORT_AGENT',
    'SUPPORT_LEAD',
  ),
  'moderation.act': allow('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SUPPORT_LEAD'),
};

export const isKnownPermission = (code: string): code is PermissionCode =>
  (PERMISSION_CODES as readonly string[]).includes(code);

export const isKnownRole = (code: string): code is RoleCode =>
  (ROLE_CODES as readonly string[]).includes(code);

export const grantFor = (role: RoleCode, permission: PermissionCode): Grant =>
  PERMISSION_MATRIX[permission][role];

export const permissionsForRole = (role: RoleCode): PermissionCode[] =>
  PERMISSION_CODES.filter((code) => grantFor(role, code) !== 'DENY');

export const rolesWithPermission = (permission: PermissionCode): RoleCode[] =>
  ROLE_CODES.filter((role) => grantFor(role, permission) !== 'DENY');

/**
 * The decision `authorize()` makes: does any role the principal holds carry this permission?
 *
 * A conditional grant answers true here. The condition is a second gate at the service layer, not a
 * reason to refuse at the catalogue layer — collapsing the two would make `user.view_pii` invisible
 * to a support agent who does have an open ticket.
 *
 * Unknown roles and unknown permissions answer false: a permission string that is not in the
 * catalogue is a typo or a module that has not landed, and either way nobody holds it.
 */
export const isAllowed = (roles: readonly string[], permission: string): boolean => {
  if (!isKnownPermission(permission)) return false;
  return roles.some((role) => isKnownRole(role) && grantFor(role, permission) !== 'DENY');
};

export const conditionFor = (role: RoleCode, permission: PermissionCode): GrantCondition | undefined => {
  const grant = grantFor(role, permission);
  return typeof grant === 'object' ? grant.condition : undefined;
};

/**
 * Written out rather than derived, so the matrix test compares two independent numbers. A
 * permission added without updating these fails the test even if its matrix row is complete.
 */
export const CATALOGUE_COUNTS = {
  roles: 14,
  permissions: 70,
  cells: 980,
  grants: 214,
  grantsByRole: {
    SUPER_ADMIN: 48,
    OPERATIONS_ADMIN: 40,
    FINANCE_ADMIN: 14,
    COMPLIANCE_OFFICER: 19,
    FRAUD_ANALYST: 16,
    KYC_ANALYST: 14,
    DISPUTE_REVIEWER: 8,
    DISPUTE_LEAD: 6,
    SUPPORT_AGENT: 11,
    SUPPORT_LEAD: 19,
    LOGISTICS_OPERATOR: 3,
    PARK_OPERATIONS: 6,
    ANALYST: 4,
    READ_ONLY: 6,
  },
} as const;
