#!/usr/bin/env node
// `pnpm migration:safety`. Exit 1 on any error-severity finding; warnings are printed and allowed.
import { applyMigrations, introspectInvariants, scratchDatabase, writeInvariants } from './database.mjs';
import { runChecks } from './check.mjs';
import { loadMigrations, writeLock } from './migrations.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const given = argv[index + 1];
  if (!given || given.startsWith('--')) {
    process.stderr.write(`migration-safety: --${name} needs a value\n`);
    process.exit(2);
  }
  return given;
};

if (flag('help')) {
  process.stdout.write(
    `Usage: pnpm migration:safety [options]

  --static              only the checks that need no database
  --base-ref <ref>      apply forward from this ref instead of origin/main
  --update-lock         rewrite migrations.lock.json from the migration folder
  --update-invariants   rewrite invariants.json from a replay of the migrations
`,
  );
  process.exit(0);
}

if (flag('update-lock')) {
  writeLock();
  process.stdout.write('migration-safety: migrations.lock.json rewritten\n');
  process.exit(0);
}

if (flag('update-invariants')) {
  const invariants = await scratchDatabase('capture', async (client) => {
    await applyMigrations(client, loadMigrations());
    return introspectInvariants(client);
  });
  writeInvariants(invariants);
  process.stdout.write('migration-safety: invariants.json rewritten\n');
  process.exit(0);
}

const { findings, counts, ran } = await runChecks({ staticOnly: flag('static'), ref: value('base-ref') });

for (const item of findings)
  process.stdout.write(`${item.severity}: ${item.check}/${item.rule} ${item.message}\n\n`);

// Name every check that ran, so a check that quietly did nothing cannot read as a check that passed.
process.stdout.write(
  `migration-safety: ${counts.migrations} migrations, ${counts.waived} waived statement(s); ` +
    `ran ${ran.join(', ')}` +
    (ran.includes('replay') ? `; ${counts.replayed} replayed, ${counts.invariants} invariants` : '') +
    `; ${counts.errors} error(s), ${counts.warnings} warning(s)\n`,
);
process.exit(counts.errors ? 1 : 0);
