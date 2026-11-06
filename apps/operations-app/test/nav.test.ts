import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_HREF, SECTIONS, SECTION_IDS, canOpen, landingFor, sectionsFor } from '../src/shell/nav';
import { PERMISSION_CODES, permissionSet, type PermissionCode } from '../src/shell/permissions';

const held = (...codes: PermissionCode[]) => new Set<PermissionCode>(codes);
const labels = (set: ReadonlySet<PermissionCode>) => sectionsFor(set).map((section) => section.label);

describe('the permission list', () => {
  it('is the backend catalogue, code for code', () => {
    const catalogue = readFileSync(
      fileURLToPath(
        new URL('../../backend-api/src/modules/identity/domain/rbac/catalog.ts', import.meta.url),
      ),
      'utf8',
    );
    const block = /export const PERMISSION_CODES = \[(.*?)\] as const;/s.exec(catalogue)?.[1] ?? '';
    const codes = [...block.matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(50);
    expect([...PERMISSION_CODES]).toEqual(codes);
  });

  it('drops a code it does not know instead of trusting it', () => {
    expect([...permissionSet(['cases.view', 'made.up', 'role.grant'])].sort()).toEqual([
      'cases.view',
      'role.grant',
    ]);
  });
});

describe('the sidebar table', () => {
  it('has the twelve sections of the ticket, in its order', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      'Work Queue',
      'Trades',
      'Disputes',
      'Identity / KYB',
      'Fraud & Risk',
      'Park Hubs',
      'Parcels / Custody',
      'Payments / Settlement',
      'Trust Graph',
      'Audit / Trust Trail',
      'Policies',
      'Reports',
    ]);
    expect(SECTIONS.map((section) => section.id)).toEqual([...SECTION_IDS]);
  });

  it('gives every section its own path and at least one permission', () => {
    expect(new Set(SECTIONS.map((section) => section.href)).size).toBe(SECTIONS.length);
    for (const section of SECTIONS) {
      expect(section.href).toBe(`/${section.id}`);
      expect(section.permissions.length).toBeGreaterThan(0);
    }
  });
});

describe('permission filtering', () => {
  it('shows nothing to someone who holds nothing: deny by default', () => {
    expect(sectionsFor(held())).toEqual([]);
    expect(landingFor(held())).toBe(ACCOUNT_HREF);
  });

  it('shows a section for any one of its permissions', () => {
    expect(labels(held('trade.view'))).toEqual(['Trades']);
    expect(labels(held('trade.view_all'))).toEqual(['Trades']);
    expect(labels(held('merchant.application.view'))).toEqual(['Identity / KYB']);
  });

  it('does not open a section for a permission that merely sounds related', () => {
    // Acting on a thing is not the same as seeing it, and `risk.resolve` alone opens nothing.
    expect(labels(held('risk.resolve', 'payment.refund', 'config.manage'))).toEqual([]);
  });

  it('draws a KYC analyst the identity section and not the money', () => {
    const analyst = held('verification.view', 'verification.review', 'duplicate_flag.view', 'cases.view');
    expect(labels(analyst)).toEqual(['Work Queue', 'Identity / KYB', 'Trust Graph']);
  });

  it('draws a finance admin payments, audit and reports', () => {
    const finance = held('payment.view', 'payout.view', 'audit.view', 'analytics.run_report');
    expect(labels(finance)).toEqual(['Payments / Settlement', 'Audit / Trust Trail', 'Reports']);
  });

  it('keeps the sidebar order whatever order the permissions arrive in', () => {
    expect(labels(held('analytics.view', 'trade.view', 'cases.view'))).toEqual([
      'Work Queue',
      'Trades',
      'Reports',
    ]);
  });

  it('lands on the first section the viewer may open', () => {
    expect(landingFor(held('dispute.view', 'analytics.view'))).toBe('/disputes');
  });

  it('answers a page the same way the sidebar does', () => {
    const everyone = new Set<PermissionCode>(PERMISSION_CODES);
    for (const id of SECTION_IDS) {
      expect(canOpen(everyone, id)).toBe(true);
      expect(canOpen(held(), id)).toBe(false);
    }
  });

  it('opens every section to someone holding every permission', () => {
    expect(sectionsFor(new Set<PermissionCode>(PERMISSION_CODES))).toHaveLength(SECTIONS.length);
  });
});
