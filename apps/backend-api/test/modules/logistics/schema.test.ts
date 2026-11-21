// T-085, m2 §11: the logistics schema carries no pricing of any kind. A delivery fee is agreed between
// the seller and the company outside Komtru, so a column that could hold one is a decision reversed by
// accident. Checked over every table the schema declares, so a later table cannot slip one in.
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../../../src/modules/logistics/infrastructure/postgres/schema/index.js';
import { PARK_COMPANY_ID } from '../../../src/modules/logistics/domain/company.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tables = (Object.values(schema) as unknown[]).filter(
  (value): value is PgTable => value instanceof PgTable,
);

const PRICING = /price|rate|quote|fee|amount|cost|tariff|charge|payout|kobo|naira/i;

describe('the logistics schema (T-085)', () => {
  it('declares the five m2 tables, all in the logistics schema', () => {
    expect(tables.map((table) => getTableConfig(table).name).sort()).toEqual([
      'logistics_companies',
      'logistics_company_members',
      'logistics_member_invitations',
      'logistics_package_status_events',
      'logistics_packages',
    ]);
    for (const table of tables) expect(getTableConfig(table).schema).toBe('logistics');
  });

  it('has no price, rate or quote column anywhere (m2 §11)', () => {
    const columns = tables.flatMap((table) =>
      getTableConfig(table).columns.map((column) => `${getTableConfig(table).name}.${column.name}`),
    );
    expect(columns.length).toBeGreaterThan(30);
    expect(columns.filter((name) => PRICING.test(name.split('.')[1] ?? ''))).toEqual([]);
  });

  it('enforces the m2 invariants with partial unique indexes, not service checks', () => {
    const unique = (table: PgTable) =>
      getTableConfig(table)
        .indexes.filter((index) => index.config.unique)
        .map((index) => index.config.name);
    expect(unique(schema.logisticsCompanyMembers).sort()).toEqual([
      'logistics_company_members_active_user_uidx',
      'logistics_company_members_company_user_live_uidx',
    ]);
    expect(unique(schema.logisticsCompanies)).toEqual(['logistics_companies_one_default_uidx']);
    expect(unique(schema.logisticsPackages)).toEqual(['logistics_packages_trade_live_uidx']);
    expect(unique(schema.logisticsMemberInvitations)).toEqual(['logistics_member_invitations_pending_uidx']);
  });

  it('keeps references to identity and trades soft: the only foreign keys stay inside the schema', () => {
    for (const table of tables) {
      for (const fk of getTableConfig(table).foreignKeys) {
        expect(getTableConfig(fk.reference().foreignTable).schema).toBe('logistics');
      }
    }
  });

  it('seeds Park as the one ENABLED default company, and makes the status history append-only', () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../../../drizzle/0057_logistics_companies.sql', import.meta.url)),
      'utf8',
    );
    expect(sql).toContain(`VALUES ('${PARK_COMPANY_ID}', 'Komtru Park', 'ENABLED', true)`);
    expect(sql).toContain(
      'CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON "logistics"."logistics_package_status_events"',
    );
    expect(sql).not.toMatch(/"[a-z_]*(price|rate|quote|fee|amount|cost)[a-z_]*"/i);
  });
});
