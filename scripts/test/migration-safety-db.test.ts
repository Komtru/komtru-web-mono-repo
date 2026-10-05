// The half of tools/migration-safety that needs a Postgres: the replay from empty, the schema
// fingerprint the forward check compares against, and the introspected list of schema-level
// invariants. Runs only with KOMTRU_INFRA_TESTS=1, against throwaway databases it creates and drops.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  applyMigrations,
  checkInvariants,
  directUrl,
  fingerprint,
  introspectInvariants,
  readInvariants,
  scratchDatabase,
} from '../../tools/migration-safety/database.mjs';
import type { Invariants } from '../../tools/migration-safety/database.mjs';
import { baseMigrations, compareForward } from '../../tools/migration-safety/check.mjs';
import { loadMigrations } from '../../tools/migration-safety/migrations.mjs';

const enabled = process.env.KOMTRU_INFRA_TESTS === '1';
const rules = (findings: { rule: string }[]) => findings.map((finding) => finding.rule);

describe.runIf(enabled)('replaying the migrations', () => {
  it('applies every migration to an empty database and skips none', async () => {
    const result = await scratchDatabase('replay', async (client) => {
      const first = await applyMigrations(client, loadMigrations());
      const columns = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM information_schema.columns WHERE table_schema IN ('identity', 'platform')`,
      );
      return { first, columns: Number(columns.rows[0]?.count) };
    });
    expect(result.first.applied).toHaveLength(16);
    expect(result.first.skipped).toEqual([]);
    expect(result.columns).toBeGreaterThan(100);
  });

  it('is a no-op the second time, as the migrator is on every deploy', async () => {
    const result = await scratchDatabase('replay-twice', async (client) => {
      const migrations = loadMigrations();
      await applyMigrations(client, migrations);
      const before = await fingerprint(client);
      const second = await applyMigrations(client, migrations);
      return { second, before, after: await fingerprint(client) };
    });
    expect(result.second.applied).toEqual([]);
    expect(result.after).toEqual(result.before);
  });

  it('skips a migration generated before one already applied, as the migrator silently does', async () => {
    const migrations = loadMigrations();
    const stale = {
      ...migrations.at(-1)!,
      tag: '0016_stale',
      when: migrations[0]!.when - 1,
      sha256: 'f'.repeat(64),
    };
    const result = await scratchDatabase('replay-stale', async (client) => {
      await applyMigrations(client, migrations);
      return applyMigrations(client, [...migrations, stale]);
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((migration) => migration.tag)).toEqual(['0016_stale']);
  });

  it('drops its database even when a migration throws', async () => {
    const name = 'crash';
    await expect(
      scratchDatabase(name, async (client) => {
        await applyMigrations(client, [
          {
            idx: 0,
            tag: '0000_bad',
            when: 1,
            sql: 'CREATE TABLE "no"."where" ("id" int);',
            sha256: '',
            snapshot: {},
          },
        ] as never);
      }),
    ).rejects.toThrow();
    const admin = new pg.Client({ connectionString: directUrl('postgres') });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE datname LIKE $1',
        [`%_${name}`],
      );
      expect(rows).toEqual([]);
    } finally {
      await admin.end();
    }
  });
});

describe.runIf(enabled)('the schema-level invariants', () => {
  const introspect = () =>
    scratchDatabase('invariants', async (client) => {
      await applyMigrations(client, loadMigrations());
      return introspectInvariants(client);
    });

  it('finds the partial unique indexes, check constraints and triggers the migrations create', async () => {
    const invariants = await introspect();
    // Every partial unique index in the identity module is a business rule that no application code
    // can be trusted to keep: one primary email per user, one verified owner of a phone number, and
    // so on. If one of these counts changes, a rule changed.
    expect(invariants.partialUniqueIndexes.map((entry) => entry.name).sort()).toEqual([
      'admin_role_active_unique',
      'mfa_factors_one_default',
      'social_identities_one_per_provider',
      'social_identities_provider_subject',
      'user_emails_one_primary',
      'user_emails_verified_unique',
      'user_phones_one_primary',
      'user_phones_verified_unique',
    ]);
    expect(invariants.triggers.map((entry) => entry.name).sort()).toEqual([
      'admin_role_dual_approval',
      'komtru_append_only',
      'roles_dual_approval_backfill',
    ]);
    expect(invariants.checkConstraints).toHaveLength(10);
    expect(invariants.postgresMajor).toBeGreaterThanOrEqual(16);
  });

  it('matches the committed invariants file exactly', async () => {
    expect(checkInvariants(await introspect(), readInvariants())).toEqual([]);
  });

  it('reports invariant-removed when the database lost one the file lists', async () => {
    const actual = await introspect();
    const expected = readInvariants();
    actual.triggers = actual.triggers.filter((entry) => entry.name !== 'komtru_append_only');
    const findings = checkInvariants(actual, expected);
    expect(rules(findings)).toEqual(['invariant-removed']);
    expect(findings[0]?.message).toContain('komtru_append_only');
  });

  it('reports invariant-added when a migration adds one nobody wrote down', async () => {
    const actual = await introspect();
    const expected = readInvariants();
    expected.checkConstraints = expected.checkConstraints.slice(1);
    expect(rules(checkInvariants(actual, expected))).toEqual(['invariant-added']);
  });

  it('reports invariant-changed when a definition is not the one on record', async () => {
    const actual = await introspect();
    const expected = readInvariants();
    expected.partialUniqueIndexes[0]!.definition += ' AND false';
    expect(rules(checkInvariants(actual, expected))).toEqual(['invariant-changed']);
  });

  it('refuses to compare across Postgres majors, which print definitions differently', async () => {
    const actual = await introspect();
    const expected: Invariants = { ...readInvariants(), postgresMajor: 99 };
    expect(rules(checkInvariants(actual, expected))).toEqual(['postgres-major']);
  });
});

describe.runIf(enabled)('applying forward from the baseline', () => {
  it('reaches the same schema as a replay from empty', async () => {
    const base = baseMigrations('HEAD');
    expect(await compareForward(base.migrations!, loadMigrations())).toEqual([]);
  });

  it('reports migration-skipped for a migration older than the baseline head', async () => {
    const base = loadMigrations();
    const stale = {
      ...base.at(-1)!,
      tag: '0016_stale',
      when: base[0]!.when - 1,
      sha256: 'f'.repeat(64),
      sql: 'CREATE SCHEMA "stale";',
    };
    const findings = await compareForward(base, [...base, stale]);
    expect(rules(findings)).toEqual(['migration-skipped', 'forward-drift']);
    expect(findings[0]?.tag).toBe('0016_stale');
  });

  it('reports forward-drift when a migration already on the baseline was edited', async () => {
    const base = loadMigrations();
    const head = base.map((migration, index) =>
      index === 10
        ? {
            ...migration,
            sha256: 'a'.repeat(64),
            sql: `${migration.sql}\n--> statement-breakpoint\nCREATE TABLE "identity"."ghost" ("id" uuid);`,
          }
        : migration,
    );
    const findings = await compareForward(base, head);
    expect(rules(findings)).toContain('forward-drift');
    expect(findings.at(-1)?.message).toContain('identity.ghost');
  });

  it('reports forward-rewritten when the branch renamed a migration the baseline already has', async () => {
    const base = loadMigrations();
    const head = base.map((migration, index) =>
      index === 2 ? { ...migration, tag: '0002_renamed' } : migration,
    );
    expect(rules(await compareForward(base, head))).toContain('forward-rewritten');
  });
});
