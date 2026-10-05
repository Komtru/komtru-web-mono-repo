// The dangerous-operation lint. Every rule is proven to fire on a statement that would hurt a live
// database and proven not to fire on the safe way of writing the same change — and the whole set is
// proven clean against the repository's own migrations, which is the only way the check stays useful.
import { describe, expect, it } from 'vitest';
import {
  RULES,
  checkLint,
  lintMigration,
  readWaiverFile,
  splitStatements,
} from '../../tools/migration-safety/lint.mjs';
import { loadMigrations } from '../../tools/migration-safety/migrations.mjs';
import type { Finding } from '../../tools/migration-safety/migrations.mjs';

const existingTables = new Set(['identity.users', 'identity.identity_audit_log']);
const rules = (findings: Finding[]) => findings.map((finding) => finding.rule);
const lint = (sql: string, waivers: Record<string, string> = {}) =>
  rules(lintMigration({ tag: '0099_fixture', sql, existingTables, waivers }));

describe('splitStatements', () => {
  it('splits on drizzle statement breakpoints', () => {
    expect(splitStatements('SELECT 1;--> statement-breakpoint\nSELECT 2;')).toHaveLength(2);
  });

  it('does not split on a semicolon inside a string literal', () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b');")).toEqual(["INSERT INTO t VALUES ('a;b')"]);
  });

  it('does not split on a semicolon inside a dollar-quoted body', () => {
    const sql = 'CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$;\nSELECT 1;';
    expect(splitStatements(sql)).toHaveLength(2);
  });

  it('is not fooled by a dollar sign inside a string literal', () => {
    // 0006 ends a CHECK regex with $', which a naive dollar-quote scanner reads as an open body.
    const sql = `ALTER TABLE t ADD CONSTRAINT c CHECK (p ~ '^\\+[1-9][0-9]{7,14}$');\nSELECT 1;`;
    expect(splitStatements(sql)).toHaveLength(2);
  });

  it('does not split on a semicolon inside a comment', () => {
    expect(splitStatements('-- a; b\nSELECT 1;')).toHaveLength(1);
  });
});

describe('rules that fire', () => {
  it.each([
    ['drop-object', 'ALTER TABLE "identity"."users" DROP COLUMN "bio";'],
    ['drop-object', 'DROP TABLE "identity"."users";'],
    ['drop-object', 'TRUNCATE "identity"."users";'],
    ['index-lock', 'CREATE INDEX "x" ON "identity"."users" USING btree ("locale");'],
    ['index-lock', 'CREATE UNIQUE INDEX "x" ON "identity"."users" ("locale");'],
    ['drop-index-lock', 'DROP INDEX "identity"."users_status_idx";'],
    ['concurrently-in-transaction', 'CREATE INDEX CONCURRENTLY "x" ON "identity"."users" ("locale");'],
    ['not-null-no-default', 'ALTER TABLE "identity"."users" ALTER COLUMN "locale" SET NOT NULL;'],
    ['not-null-no-default', 'ALTER TABLE "identity"."users" ADD COLUMN "nickname" text NOT NULL;'],
    ['type-change', 'ALTER TABLE "identity"."users" ALTER COLUMN "locale" TYPE varchar(8);'],
    ['constraint-scan', `ALTER TABLE "identity"."users" ADD CONSTRAINT "c" CHECK ("locale" <> '');`],
    [
      'constraint-scan',
      'ALTER TABLE "identity"."users" ADD CONSTRAINT "f" FOREIGN KEY ("id") REFERENCES "identity"."users"("id");',
    ],
    ['rename', 'ALTER TABLE "identity"."users" RENAME COLUMN "locale" TO "lang";'],
    ['backfill', `UPDATE "identity"."users" SET "locale" = 'en-NG';`],
    ['backfill', 'DELETE FROM "identity"."users" WHERE "closed_at" IS NOT NULL;'],
  ])('fires %s', (rule, sql) => {
    expect(lint(sql)).toContain(rule);
  });
});

describe('rules that stay quiet', () => {
  it.each([
    [
      'an index on a table the same migration creates',
      'CREATE TABLE "identity"."tags" ("id" uuid);\nCREATE INDEX "t" ON "identity"."tags" ("id");',
    ],
    [
      'a constraint added NOT VALID',
      'ALTER TABLE "identity"."users" ADD CONSTRAINT "c" CHECK ("locale" <> \'\') NOT VALID;',
    ],
    ['validating a constraint added earlier', 'ALTER TABLE "identity"."users" VALIDATE CONSTRAINT "c";'],
    [
      'a nullable column added to an existing table',
      'ALTER TABLE "identity"."users" ADD COLUMN "nickname" text;',
    ],
    [
      'a NOT NULL column added with a default',
      `ALTER TABLE "identity"."users" ADD COLUMN "n" text DEFAULT '' NOT NULL;`,
    ],
    ['a grant', 'GRANT INSERT, SELECT ON "identity"."users" TO komtru_app;'],
    ['a new table with NOT NULL columns', 'CREATE TABLE "identity"."tags" ("id" uuid NOT NULL);'],
  ])('stays quiet for %s', (_label, sql) => {
    expect(lint(sql)).toEqual([]);
  });

  it('ignores a dangerous statement inside a function body, which runs later under its own locks', () => {
    const sql =
      'CREATE FUNCTION identity.f() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  DROP TABLE identity.users;\n  RETURN NEW;\nEND\n$$;';
    expect(lint(sql)).toEqual([]);
  });

  it('does not ignore a DO block, which runs now', () => {
    const sql = "DO $$\nBEGIN\n  EXECUTE 'DROP TABLE identity.users';\nEND\n$$;";
    expect(lint(sql)).toContain('drop-object');
  });
});

describe('waivers', () => {
  const dropColumn = 'ALTER TABLE "identity"."users" DROP COLUMN "bio";';

  it('waives a rule the migration is listed for, with its reason', () => {
    const reason = 'expand/contract: nothing has read bio since T-099 shipped';
    expect(lint(dropColumn, { 'drop-object': reason })).toEqual([]);
  });

  it('reports unknown-waiver for a rule id that does not exist', () => {
    const waivers = { 'drop-colum': 'a typo that would otherwise silently waive nothing at all' };
    expect(lint(dropColumn, waivers)).toEqual(['unknown-waiver', 'drop-object']);
  });

  it('reports waiver-reason when the reason is too short to be a reason', () => {
    expect(lint(dropColumn, { 'drop-object': 'fine' })).toEqual(['waiver-reason', 'drop-object']);
  });

  it('reports unused-waiver so a waiver cannot outlive the statement it excused', () => {
    const waivers = { backfill: 'there is no backfill anywhere in this migration' };
    expect(lint('CREATE TABLE "identity"."tags" ("id" uuid);', waivers)).toEqual(['unused-waiver']);
  });

  it('names a real rule in every waiver it ships with, against a migration that exists', () => {
    const tags = new Set(loadMigrations().map((migration) => migration.tag));
    for (const [tag, waivers] of Object.entries(readWaiverFile())) {
      expect(tags, `${tag} is waived but is not a migration`).toContain(tag);
      for (const rule of Object.keys(waivers)) expect(Object.keys(RULES)).toContain(rule);
    }
  });
});

describe('the repository migrations', () => {
  it('has a summary for every rule', () => {
    expect(Object.values(RULES).every((rule) => rule.summary.length > 20)).toBe(true);
  });

  it('passes the lint, waivers included', () => {
    expect(checkLint()).toEqual([]);
  });
});
