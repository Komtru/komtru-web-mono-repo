// T-037: the exhaustive permission x role matrix, from ONE table.
//
// PLATFORM_TABLE below is every permission in the catalogue against every role, written out by
// hand as a table of cells (a tick is a grant, a warning sign is a conditional grant, a cross is a
// deny). It is the *expectation*; the catalogue in src/ is the thing under test, and they are
// compared cell by cell. Three guards stop the catalogue growing silently:
//
//   - a permission or role added to the catalogue without a row or column here fails the parse;
//   - a row added here without the catalogue fails the cell comparison;
//   - either change without updating CATALOGUE_COUNTS fails the asserted counts.
//
// The first 22 rows are M1 section 12.3. Rather than trust a transcription of them, a second test
// parses that section out of the spec file itself and compares the twelve M1 columns to the
// catalogue, so the baseline cannot drift from the document that defines it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_COUNTS,
  PERMISSIONS,
  PERMISSION_CODES,
  PERMISSION_MATRIX,
  ROLE_CODES,
  type PermissionCode,
  type RoleCode,
  grantFor,
  permissionsForRole,
  rolesWithPermission,
} from '../../../../../src/modules/identity/domain/rbac/catalog.js';

const PLATFORM_TABLE = `
| Permission | SUP | OPS | FIN | CMP | FRD | KYC | DIS | DLD | SAG | SLD | LOG | PRK | ANL | RDO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| \`user.view\` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| \`user.view_pii\` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| \`user.search\` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| \`user.update\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.restrict\` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.suspend\` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.reinstate\` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`user.close\` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| \`user.impersonate\` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`username.reserve\` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`username.force_change\` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`session.view\` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| \`session.revoke\` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`mfa.reset\` | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| \`credential.force_reset\` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`role.view\` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| \`role.grant\` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`role.revoke\` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`audit.view\` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| \`audit.export\` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`capability.grant\` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`capability.revoke\` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`trade.view\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`trade.view_all\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`trade.cancel_override\` | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`trade.dispute_escalate\` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`payment.view\` | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`payment.refund\` | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`payout.view\` | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`payout.retry\` | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`reconciliation.view\` | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`reconciliation.resolve\` | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`dispute.view\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`dispute.submit_evidence\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`dispute.assign\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`dispute.decide\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`dispute.appeal\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`dispute.decide_appeal\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`verification.view\` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`verification.review\` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`verification.override\` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`duplicate_flag.view\` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`duplicate_flag.resolve\` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`provider_call.view\` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`ticket.view\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`ticket.assign\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`ticket.resolve\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`ticket.reassign\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`ticket.escalate_to_dispute\` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`geo.manage\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`merchant.application.view\` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`merchant.application.decide\` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`risk.view\` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`risk.resolve\` | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`logistics.manage\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| \`park.view\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| \`park.manage\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| \`cases.view\` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| \`cases.manage\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| \`config.view\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`config.manage\` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`compliance.view\` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`compliance.dsr_fulfill\` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`compliance.retention_manage\` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`analytics.view\` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| \`analytics.run_report\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`growth.view\` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| \`growth.manage\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| \`moderation.view\` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| \`moderation.act\` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
`;

const ABBREVIATIONS: Record<string, RoleCode> = {
  SUP: 'SUPER_ADMIN',
  OPS: 'OPERATIONS_ADMIN',
  FIN: 'FINANCE_ADMIN',
  CMP: 'COMPLIANCE_OFFICER',
  FRD: 'FRAUD_ANALYST',
  KYC: 'KYC_ANALYST',
  DIS: 'DISPUTE_REVIEWER',
  DLD: 'DISPUTE_LEAD',
  SAG: 'SUPPORT_AGENT',
  SLD: 'SUPPORT_LEAD',
  LOG: 'LOGISTICS_OPERATOR',
  PRK: 'PARK_OPERATIONS',
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

type Mark = 'DENY' | 'ALLOW' | 'CONDITIONAL';
const markOf = (cell: string): Mark =>
  cell.startsWith('✅') ? 'ALLOW' : cell.startsWith('⚠️') ? 'CONDITIONAL' : 'DENY';

const parseTable = (text: string, expectedHeader?: readonly string[]) => {
  const rows = text
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*:?-{2,}/.test(line));
  const header = cells(rows[0] ?? '').slice(1);
  if (expectedHeader) expect(header).toEqual([...expectedHeader]);
  const marks = new Map<string, Mark>();
  const order: string[] = [];
  for (const line of rows.slice(1)) {
    const [name, ...values] = cells(line);
    const permission = (name ?? '').replace(/`/g, '');
    order.push(permission);
    values.forEach((value, index) => marks.set(`${permission}|${header[index]}`, markOf(value)));
  }
  return { header, marks, order };
};

const platform = parseTable(PLATFORM_TABLE);
const roleOf = (abbreviation: string): RoleCode => ABBREVIATIONS[abbreviation] as RoleCode;
const specMark = (permission: string, role: RoleCode): Mark | undefined => {
  const abbreviation = Object.keys(ABBREVIATIONS).find((key) => ABBREVIATIONS[key] === role);
  return platform.marks.get(`${permission}|${abbreviation}`);
};

const catalogueMark = (role: RoleCode, permission: PermissionCode): Mark => {
  const grant = grantFor(role, permission);
  return grant === 'DENY' ? 'DENY' : grant === 'ALLOW' ? 'ALLOW' : 'CONDITIONAL';
};

describe('platform permission matrix', () => {
  it('parses every cell of the table', () => {
    expect(platform.header.map(roleOf)).toEqual([...ROLE_CODES]);
    expect(platform.order).toEqual([...PERMISSION_CODES]);
    expect(platform.marks.size).toBe(CATALOGUE_COUNTS.cells);
  });

  it.each(PERMISSION_CODES.flatMap((permission) => ROLE_CODES.map((role) => [permission, role] as const)))(
    '%s x %s matches the table',
    (permission, role) => {
      expect(catalogueMark(role, permission)).toBe(specMark(permission, role));
    },
  );

  it('places every permission in the matrix and every role in every row', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...PERMISSION_CODES].sort());
    for (const permission of PERMISSION_CODES)
      expect(Object.keys(PERMISSION_MATRIX[permission]).sort()).toEqual([...ROLE_CODES].sort());
  });

  it('asserts the counts, so adding a permission without updating them fails', () => {
    expect(CATALOGUE_COUNTS).toEqual({
      roles: 14,
      permissions: 70,
      cells: 980,
      grants: 212,
      grantsByRole: {
        SUPER_ADMIN: 48,
        OPERATIONS_ADMIN: 40,
        FINANCE_ADMIN: 14,
        COMPLIANCE_OFFICER: 19,
        FRAUD_ANALYST: 16,
        KYC_ANALYST: 14,
        DISPUTE_REVIEWER: 7,
        DISPUTE_LEAD: 6,
        SUPPORT_AGENT: 11,
        SUPPORT_LEAD: 18,
        LOGISTICS_OPERATOR: 3,
        PARK_OPERATIONS: 6,
        ANALYST: 4,
        READ_ONLY: 6,
      },
    });
    expect(ROLE_CODES.length).toBe(CATALOGUE_COUNTS.roles);
    expect(PERMISSION_CODES.length).toBe(CATALOGUE_COUNTS.permissions);
    expect(PERMISSIONS.length).toBe(CATALOGUE_COUNTS.permissions);
    expect(ROLE_CODES.length * PERMISSION_CODES.length).toBe(CATALOGUE_COUNTS.cells);
    expect(PERMISSION_CODES.reduce((n, p) => n + rolesWithPermission(p).length, 0)).toBe(
      CATALOGUE_COUNTS.grants,
    );
    expect([...platform.marks.values()].filter((mark) => mark !== 'DENY')).toHaveLength(
      CATALOGUE_COUNTS.grants,
    );
    for (const role of ROLE_CODES)
      expect(permissionsForRole(role)).toHaveLength(CATALOGUE_COUNTS.grantsByRole[role]);
    expect(Object.values(CATALOGUE_COUNTS.grantsByRole).reduce((a, b) => a + b, 0)).toBe(
      CATALOGUE_COUNTS.grants,
    );
  });

  it('denies by default: the blanks outnumber the grants', () => {
    expect(CATALOGUE_COUNTS.cells - CATALOGUE_COUNTS.grants).toBe(768);
  });

  it('counts the merchant application and geo grants the ticket names', () => {
    for (const permission of ['merchant.application.view', 'merchant.application.decide'] as const)
      expect(rolesWithPermission(permission)).toEqual(['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'KYC_ANALYST']);
    expect(rolesWithPermission('geo.manage')).toEqual(['SUPER_ADMIN', 'OPERATIONS_ADMIN']);
  });

  it('keeps the party-only dispute permissions out of every staff role', () => {
    expect(rolesWithPermission('dispute.submit_evidence')).toEqual([]);
    expect(rolesWithPermission('dispute.appeal')).toEqual([]);
  });

  it('never lets the original reviewer decide the appeal (M3 D5)', () => {
    expect(rolesWithPermission('dispute.decide_appeal')).toEqual(['DISPUTE_LEAD']);
    expect(rolesWithPermission('dispute.decide')).toEqual(['DISPUTE_REVIEWER']);
  });

  // M1 section 12.3's closing note: the row exists so that the deny is explicit rather than accidental.
  it('neither ANALYST nor READ_ONLY sees PII', () => {
    for (const role of ['ANALYST', 'READ_ONLY'] as const)
      expect(grantFor(role, 'user.view_pii')).toBe('DENY');
  });

  it('lets only LOGISTICS_OPERATOR, with the owners, manage logistics', () => {
    expect(rolesWithPermission('logistics.manage')).toEqual([
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'LOGISTICS_OPERATOR',
    ]);
  });
});

const SPEC_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../docs/specs/module-01-identity-and-user-management.md',
);

describe('M1 section 12.3 against the spec file itself', () => {
  const markdown = readFileSync(SPEC_FILE, 'utf8');
  const start = markdown.indexOf('### 12.3 Matrix');
  const section = markdown.slice(start, markdown.indexOf('¹ Support sees masked PII', start));
  const spec = parseTable(section);
  const m1Roles = spec.header.map(roleOf);

  it('finds the spec table: 22 permissions across the 12 original roles', () => {
    expect(start).toBeGreaterThan(0);
    expect(spec.order).toHaveLength(22);
    expect(m1Roles).toHaveLength(12);
    expect(m1Roles.every((role) => ROLE_CODES.includes(role))).toBe(true);
    expect([...spec.order].sort()).toEqual([...PERMISSION_CODES.slice(0, 22)].sort());
  });

  it.each(
    spec.order.flatMap((permission) =>
      spec.header.map((abbreviation) => [permission, abbreviation] as const),
    ),
  )('%s x %s equals the spec', (permission, abbreviation) => {
    // The spec puts a footnote on some ticks (`✅²`) where the catalogue records a conditional
    // grant, so the comparison is "holds it or not"; the conditions are asserted in catalog.test.ts.
    expect(catalogueMark(roleOf(abbreviation), permission as PermissionCode) !== 'DENY').toBe(
      spec.marks.get(`${permission}|${abbreviation}`) !== 'DENY',
    );
  });

  it('grants the two new roles nothing the spec table did not name, bar the universal reads', () => {
    for (const role of ['DISPUTE_LEAD', 'PARK_OPERATIONS'] as const)
      expect(permissionsForRole(role).filter((code) => spec.order.includes(code))).toEqual([
        'user.view',
        'user.search',
      ]);
  });
});
