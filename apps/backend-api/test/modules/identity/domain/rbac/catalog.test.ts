// M1 §12.1 and §12.2: the shape of the catalogue. The cell-by-cell comparison against §12.3 lives
// in matrix.test.ts.
import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_CODES,
  ROLES,
  ROLE_CODES,
  conditionFor,
  grantFor,
  isAllowed,
  isKnownPermission,
  isKnownRole,
  permissionsForRole,
} from '../../../../../src/modules/identity/domain/rbac/catalog.js';

describe('rbac catalogue', () => {
  it('holds M1 §12.1 and §12.2 exactly', () => {
    expect([...ROLE_CODES]).toEqual([
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
    ]);
    expect([...PERMISSION_CODES]).toEqual([
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
    ]);
    expect(ROLES.map((r) => r.code)).toEqual([...ROLE_CODES]);
    expect(PERMISSIONS.map((p) => p.code)).toEqual([...PERMISSION_CODES]);
  });

  it('requires dual approval for exactly the three §12.1 roles', () => {
    expect(ROLES.filter((r) => r.requiresDualApproval).map((r) => r.code)).toEqual([
      'SUPER_ADMIN',
      'FINANCE_ADMIN',
      'COMPLIANCE_OFFICER',
    ]);
  });

  it('derives domain and action from the permission code', () => {
    for (const p of PERMISSIONS) {
      expect(`${p.domain}.${p.action}`).toBe(p.code);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('denies by default, including for SUPER_ADMIN', () => {
    expect(isAllowed([], 'user.view')).toBe(false);
    expect(isAllowed(['SUPER_ADMIN'], 'trade.refund')).toBe(false);
    expect(isAllowed(['NOT_A_ROLE'], 'user.view')).toBe(false);
    expect(isAllowed(['READ_ONLY'], 'user.view_pii')).toBe(false);
    expect(isKnownPermission('trade.refund')).toBe(false);
    expect(isKnownRole('DISPUTE_LEAD')).toBe(false);
  });

  it('treats a conditional grant as allowed at the catalogue layer', () => {
    expect(grantFor('SUPPORT_AGENT', 'user.view_pii')).toEqual({
      allow: true,
      condition: 'TICKET_SCOPED_PII',
    });
    expect(isAllowed(['SUPPORT_AGENT'], 'user.view_pii')).toBe(true);
    expect(conditionFor('SUPPORT_LEAD', 'user.close')).toBe('DOCUMENTED_USER_REQUEST');
    expect(conditionFor('SUPER_ADMIN', 'user.impersonate')).toBe('READ_ONLY_TIME_BOXED');
    for (const role of ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SUPPORT_LEAD'] as const)
      expect(conditionFor(role, 'mfa.reset')).toBe('ADMIN_ACTION_APPROVAL');
    expect(conditionFor('SUPER_ADMIN', 'user.view')).toBeUndefined();
  });

  it('expresses the §12.3 note-5 offboarding path', () => {
    expect(grantFor('COMPLIANCE_OFFICER', 'role.revoke')).toBe('ALLOW');
    expect(grantFor('COMPLIANCE_OFFICER', 'role.grant')).toBe('DENY');
  });

  it('unions the roles a principal holds', () => {
    expect(isAllowed(['READ_ONLY'], 'user.restrict')).toBe(false);
    expect(isAllowed(['READ_ONLY', 'FRAUD_ANALYST'], 'user.restrict')).toBe(true);
  });

  it('marks the destructive and financial permissions', () => {
    expect(PERMISSIONS.filter((p) => p.isFinancial).map((p) => p.code)).toEqual(['audit.export']);
    expect(PERMISSIONS.filter((p) => p.isDestructive).map((p) => p.code)).toEqual([
      'user.restrict',
      'user.suspend',
      'user.close',
      'user.impersonate',
      'username.force_change',
      'session.revoke',
      'mfa.reset',
      'credential.force_reset',
      'role.grant',
      'role.revoke',
      'capability.revoke',
    ]);
  });

  it('gives every role at least the two universal read permissions', () => {
    for (const role of ROLE_CODES)
      expect(permissionsForRole(role)).toEqual(expect.arrayContaining(['user.view', 'user.search']));
  });
});
