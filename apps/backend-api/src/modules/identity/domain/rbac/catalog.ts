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
// **T-037 extends this file** with the remaining modules' slices (trade, payment, payout,
// reconciliation, dispute, verification, duplicate flag, ticket, risk, logistics, park, cases,
// config, audit, analytics, growth, messaging moderation), the `DISPUTE_LEAD` and `PARK_OPERATIONS`
// roles, and `geo.manage` / `merchant.application.view` / `merchant.application.decide`. Every such
// change must update CATALOGUE_COUNTS and the spec table in the matrix test in the same commit.

/** M1 §12.1, in the spec's order. */
export const ROLE_CODES = [
  'SUPER_ADMIN',
  'OPERATIONS_ADMIN',
  'FINANCE_ADMIN',
  'COMPLIANCE_OFFICER',
  'FRAUD_ANALYST',
  'KYC_ANALYST',
  'DISPUTE_REVIEWER',
  'SUPPORT_AGENT',
  'SUPPORT_LEAD',
  'LOGISTICS_OPERATOR',
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
  SUPPORT_AGENT: grant,
  SUPPORT_LEAD: grant,
  LOGISTICS_OPERATOR: grant,
  ANALYST: grant,
  READ_ONLY: grant,
});

/**
 * Written as "deny everything, then name the holders", so a reader checks a short list of names
 * against M1 §12.3 rather than counting twelve values per row. The exhaustive matrix test compares
 * the result against the spec's table cell by cell either way.
 */
const row = (grants: Partial<Record<RoleCode, Grant>>): MatrixRow => ({ ...all('DENY'), ...grants });

const PII_UNMASK: Grant = { allow: true, condition: 'TICKET_SCOPED_PII' };
const APPROVED_ACTION: Grant = { allow: true, condition: 'ADMIN_ACTION_APPROVAL' };

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
  roles: 12,
  permissions: 22,
  cells: 264,
  grants: 105,
  grantsByRole: {
    SUPER_ADMIN: 22,
    OPERATIONS_ADMIN: 18,
    FINANCE_ADMIN: 6,
    COMPLIANCE_OFFICER: 14,
    FRAUD_ANALYST: 12,
    KYC_ANALYST: 5,
    DISPUTE_REVIEWER: 4,
    SUPPORT_AGENT: 5,
    SUPPORT_LEAD: 10,
    LOGISTICS_OPERATOR: 2,
    ANALYST: 2,
    READ_ONLY: 5,
  },
} as const;
