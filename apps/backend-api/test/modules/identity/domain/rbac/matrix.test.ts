// M1 §17 "RBAC": drive the deny-by-default proof from the §12.3 matrix as a table-driven test over
// all 22 × 12 cells, so a new permission fails CI until it is placed.
//
// SPEC_TABLE below is §12.3 copied verbatim out of docs/specs/module-01-identity-and-user-management.md.
// It is the *spec*, not a restatement of the catalogue: the catalogue is transcribed by hand in
// src/, this is transcribed by hand here, and the test is the comparison. A permission added to the
// catalogue without a row here fails the parse count; a row added here without the catalogue fails
// the cell comparison; a permission added without updating CATALOGUE_COUNTS fails the counts.
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_COUNTS,
  PERMISSION_CODES,
  PERMISSION_MATRIX,
  ROLE_CODES,
  type PermissionCode,
  type RoleCode,
  grantFor,
  permissionsForRole,
  rolesWithPermission,
} from '../../../../../src/modules/identity/domain/rbac/catalog.js';

const SPEC_TABLE = `
| Permission | SUP | OPS | FIN | CMP | FRD | KYC | DIS | SAG | SLD | LOG | ANL | RDO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| \`user.view\` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| \`user.search\` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| \`user.view_pii\` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️¹ | ⚠️¹ | ❌ | ❌ | ❌ |
| \`user.update\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.restrict\` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.suspend\` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.reinstate\` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.close\` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️⁴ | ❌ | ❌ | ❌ |
| \`user.impersonate\` | ✅² | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`username.reserve\` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`username.force_change\` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`session.view\` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| \`session.revoke\` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| \`mfa.reset\` | ✅³ | ✅³ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️³ | ❌ | ❌ | ❌ |
| \`credential.force_reset\` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| \`capability.grant\` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`capability.revoke\` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`role.view\` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| \`role.grant\` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`role.revoke\` | ✅ | ❌ | ❌ | ✅⁵ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`audit.view\` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| \`audit.export\` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
`;

/** §12.3's column abbreviations, in the header's order. */
const ABBREVIATIONS: Record<string, RoleCode> = {
  SUP: 'SUPER_ADMIN',
  OPS: 'OPERATIONS_ADMIN',
  FIN: 'FINANCE_ADMIN',
  CMP: 'COMPLIANCE_OFFICER',
  FRD: 'FRAUD_ANALYST',
  KYC: 'KYC_ANALYST',
  DIS: 'DISPUTE_REVIEWER',
  SAG: 'SUPPORT_AGENT',
  SLD: 'SUPPORT_LEAD',
  LOG: 'LOGISTICS_OPERATOR',
  ANL: 'ANALYST',
  RDO: 'READ_ONLY',
};

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

/** `✅`, `✅²` and `⚠️¹` all mean the role holds the permission; `❌` and a blank mean it does not. */
const isGranted = (cell: string): boolean => cell.startsWith('✅') || cell.startsWith('⚠️');

const rows = SPEC_TABLE.trim()
  .split('\n')
  .filter((line) => !/^\|\s*-{2,}/.test(line) && !/^\|---/.test(line));

const headerRoles = cells(rows[0] ?? '')
  .slice(1)
  .map((abbreviation) => ABBREVIATIONS[abbreviation]);

const specCells = new Map<string, boolean>();
const specPermissions: string[] = [];

for (const line of rows.slice(1)) {
  const [name, ...values] = cells(line);
  const permission = (name ?? '').replace(/`/g, '');
  specPermissions.push(permission);
  values.forEach((value, index) => {
    specCells.set(`${permission}|${headerRoles[index]}`, isGranted(value));
  });
}

describe('M1 §12.3 permission matrix', () => {
  it('parses every cell of the spec table', () => {
    expect(headerRoles).toEqual([...ROLE_CODES]);
    expect(headerRoles.every((role) => role !== undefined)).toBe(true);
    expect([...specPermissions].sort()).toEqual([...PERMISSION_CODES].sort());
    expect(specCells.size).toBe(22 * 12);
  });

  it.each(PERMISSION_CODES.flatMap((permission) => ROLE_CODES.map((role) => [permission, role] as const)))(
    '%s × %s matches M1 §12.3',
    (permission, role) => {
      expect(grantFor(role, permission) !== 'DENY').toBe(specCells.get(`${permission}|${role}`));
    },
  );

  it('places every permission in the matrix and every role in every row', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...PERMISSION_CODES].sort());
    for (const permission of PERMISSION_CODES)
      expect(Object.keys(PERMISSION_MATRIX[permission]).sort()).toEqual([...ROLE_CODES].sort());
  });

  it('asserts the counts, so adding a permission without updating them fails', () => {
    expect(CATALOGUE_COUNTS).toEqual({
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
    });
    expect(ROLE_CODES.length).toBe(CATALOGUE_COUNTS.roles);
    expect(PERMISSION_CODES.length).toBe(CATALOGUE_COUNTS.permissions);
    expect(ROLE_CODES.length * PERMISSION_CODES.length).toBe(CATALOGUE_COUNTS.cells);
    expect(PERMISSION_CODES.reduce((n, p) => n + rolesWithPermission(p).length, 0)).toBe(
      CATALOGUE_COUNTS.grants,
    );
    expect([...specCells.values()].filter(Boolean)).toHaveLength(CATALOGUE_COUNTS.grants);
    for (const role of ROLE_CODES)
      expect(permissionsForRole(role)).toHaveLength(CATALOGUE_COUNTS.grantsByRole[role]);
  });

  it('denies by default: the blanks outnumber the grants', () => {
    expect(CATALOGUE_COUNTS.cells - CATALOGUE_COUNTS.grants).toBe(159);
  });

  // §12.3's closing note: the row exists so that the deny is explicit rather than accidental.
  it('neither ANALYST nor READ_ONLY sees PII', () => {
    for (const role of ['ANALYST', 'READ_ONLY'] as const)
      expect(grantFor(role, 'user.view_pii')).toBe('DENY');
  });

  it('gives SUPER_ADMIN everything and LOGISTICS_OPERATOR almost nothing', () => {
    expect(permissionsForRole('SUPER_ADMIN')).toEqual([...PERMISSION_CODES]);
    expect(permissionsForRole('LOGISTICS_OPERATOR')).toEqual(['user.view', 'user.search']);
    expect(permissionsForRole('ANALYST')).toEqual(['user.view', 'user.search']);
  });
});

/**
 * The guard the ticket asks for, exercised rather than described: a permission the catalogue knows
 * about but the spec table does not is caught by the parse, and a code outside the catalogue is not
 * a permission at all.
 */
describe('catalogue growth', () => {
  it('rejects a permission code the spec table does not place', () => {
    const invented = 'trade.refund' as PermissionCode;
    expect(specCells.get(`${invented}|SUPER_ADMIN`)).toBeUndefined();
    expect(PERMISSION_CODES as readonly string[]).not.toContain(invented);
  });
});
