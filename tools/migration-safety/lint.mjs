// Statements that are free on an empty table and an outage on a populated one. Every test this repo
// has runs against a database built from nothing, so nothing else can see this class of problem.
//
// Two facts about drizzle's migrator shape every rule. It runs the whole pending set inside ONE
// transaction, so (a) CONCURRENTLY is unavailable — Postgres rejects it inside a transaction block —
// and (b) a lock taken by the first statement is held until the last migration commits. So a finding
// is never fixed by adding CONCURRENTLY: either the table is small enough to lock (say so in a
// waiver) or the work belongs outside the migrator, in an operations step.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finding, loadMigrations } from './migrations.mjs';

// Waivers live here rather than in a comment in the migration, because this tool's own strongest
// rule is that a migration which has already been applied is never edited again: a new comment line
// changes the file's hash, and the migrator would never look at the file again to notice.
export const WAIVERS_PATH = resolve(fileURLToPath(new URL('.', import.meta.url)), 'waivers.json');

export const RULES = {
  'drop-object': {
    summary:
      'Destroys data. A column or table drop needs an expand/contract note: when the last reader of it shipped.',
  },
  'index-lock': {
    summary:
      'CREATE INDEX on a populated table blocks every write to it for the whole build, and the migrator holds that lock until the last pending migration commits.',
  },
  'drop-index-lock': {
    summary:
      'DROP INDEX takes ACCESS EXCLUSIVE, blocking reads as well as writes, for as long as the migration run lasts.',
  },
  'concurrently-in-transaction': {
    summary:
      'The migrator runs every migration in one transaction and Postgres refuses CONCURRENTLY there, so this fails at deploy time.',
  },
  'not-null-no-default': {
    summary:
      'SET NOT NULL scans the whole table under ACCESS EXCLUSIVE, and ADD COLUMN NOT NULL without a DEFAULT simply fails when rows exist.',
  },
  'type-change': {
    summary:
      'Changing a column type rewrites the table under ACCESS EXCLUSIVE, and a narrowing change also fails on data that no longer fits.',
  },
  'constraint-scan': {
    summary:
      'ADD CONSTRAINT validates every existing row under a strong lock; ADD ... NOT VALID followed by VALIDATE CONSTRAINT in a later migration does not.',
  },
  rename: {
    summary:
      'The previous release is still serving traffic during a deploy and still queries the old name; rename by adding, backfilling and dropping instead.',
  },
  backfill: {
    summary:
      'A data statement holds its row locks for the length of the entire migration run, not just its own; backfill from a job or a one-off script instead.',
  },
};

const MIN_REASON = 20;

const IDENT = String.raw`(?:"[^"]*"|[A-Za-z_][A-Za-z0-9_$]*)`;
const TABLE_REF = new RegExp(String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`);

const skipQuoted = (text, index, quote) => {
  for (let i = index + 1; i < text.length; i += 1) {
    if (text[i] !== quote) continue;
    if (text[i + 1] === quote) i += 1;
    else return i + 1;
  }
  return text.length;
};

/** `$$`/`$tag$` … the matching close, or null when this `$` is not a dollar quote. */
const dollarQuote = (text, index) => {
  const open = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(index));
  if (!open) return null;
  const close = text.indexOf(open[0], index + open[0].length);
  return close === -1 ? null : { end: close + open[0].length, body: [index + open[0].length, close] };
};

/**
 * Walks SQL token by token so the callers below never mistake a `;`, a `--` or a `$` inside a string
 * or a function body for the real thing. 0006's `CHECK (phone ~ '…$')` is exactly that trap.
 */
const scan = (text, visit) => {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(text, i, ch);
      visit('literal', i, end);
      i = end;
    } else if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      visit('comment', i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      visit('comment', i, end === -1 ? text.length : end + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      const dollar = ch === '$' ? dollarQuote(text, i) : null;
      if (dollar) {
        visit('dollar', i, dollar.end, dollar.body);
        i = dollar.end;
      } else {
        visit('code', i, i + 1);
        i += 1;
      }
    }
  }
};

/** The statements the migrator will execute, in order: drizzle splits on its breakpoint marker. */
export function splitStatements(sql) {
  const statements = [];
  for (const chunk of sql.split('--> statement-breakpoint')) {
    let start = 0;
    scan(chunk, (kind, from, to) => {
      if (kind === 'code' && chunk[from] === ';') {
        statements.push(chunk.slice(start, from));
        start = to;
      }
    });
    statements.push(chunk.slice(start));
  }
  return statements.map((statement) => statement.trim()).filter(Boolean);
}

const isFunctionDefinition = (statement) =>
  /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(statement);

/**
 * The text the rules match against: comments gone, whitespace collapsed, and a function body blanked
 * because that SQL runs later, on its own, under its own locks. A `DO` block keeps its body: it runs
 * now, as part of the migration.
 */
const normalize = (statement) => {
  let out = '';
  const blankBody = isFunctionDefinition(statement);
  scan(statement, (kind, from, to, body) => {
    if (kind === 'comment') out += ' ';
    else if (kind === 'dollar' && blankBody)
      out += `${statement.slice(from, body[0])}${statement.slice(body[1], to)}`;
    else out += statement.slice(from, to);
  });
  return out.replace(/\s+/g, ' ').trim();
};

/** Splits an ALTER TABLE's actions apart without breaking on a comma inside `numeric(10,2)`. */
const topLevelParts = (statement) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  scan(statement, (kind, from, to) => {
    if (kind !== 'code') return;
    const ch = statement[from];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(statement.slice(start, from));
      start = to;
    }
  });
  parts.push(statement.slice(start));
  return parts;
};

const normalizeRef = (raw) =>
  raw
    .split('.')
    .map((part) => part.trim().replace(/^"(.*)"$/s, '$1'))
    .join('.')
    .toLowerCase();

const matchRef = (statement, before) => {
  const match = new RegExp(`${before}\\s*${TABLE_REF.source}`, 'i').exec(statement);
  return match ? normalizeRef(match[1]) : null;
};

/** An unqualified name matches any known table with that name: a rule should rather fire than not. */
const isExisting = (ref, existingTables) => {
  if (!ref) return false;
  if (ref.includes('.')) return existingTables.has(ref);
  return [...existingTables].some((table) => table.split('.').at(-1) === ref);
};

const CREATE_TABLE = new RegExp(
  String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${TABLE_REF.source}`,
  'i',
);

/** Every table a migration creates, so a rule never fires against a table that is empty by construction. */
export function createdTables(sql) {
  const created = new Set();
  for (const statement of splitStatements(sql)) {
    const match = CREATE_TABLE.exec(normalize(statement));
    if (match) created.add(normalizeRef(match[1]));
  }
  return created;
}

const ADD_COLUMN = /\bADD\s+(?!CONSTRAINT\b|PRIMARY\b|UNIQUE\b|CHECK\b|FOREIGN\b|EXCLUDE\b)(?:COLUMN\s+)?/i;

/** Rule id → the statements in this migration that trip it. */
function ruleHits(statement, existingTables) {
  const hits = [];
  const alterTarget = matchRef(statement, String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?`);
  const onExisting = isExisting(alterTarget, existingTables);
  const concurrently = /\bCONCURRENTLY\b/i.test(statement);

  if (concurrently) hits.push('concurrently-in-transaction');

  if (
    /\bDROP\s+(?:TABLE|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE)\b/i.test(statement) ||
    /\bTRUNCATE\b/i.test(statement) ||
    (alterTarget && /\bDROP\s+COLUMN\b/i.test(statement))
  )
    hits.push('drop-object');

  if (/^\s*DROP\s+INDEX\b/i.test(statement) && !concurrently) hits.push('drop-index-lock');

  if (/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement) && !concurrently) {
    const target = matchRef(statement, String.raw`\bON\s+(?:ONLY\s+)?`);
    if (isExisting(target, existingTables)) hits.push('index-lock');
  }

  if (onExisting) {
    if (/\bALTER\s+(?:COLUMN\s+)?\S+\s+SET\s+NOT\s+NULL\b/i.test(statement)) hits.push('not-null-no-default');
    else if (
      topLevelParts(statement).some(
        (part) => ADD_COLUMN.test(part) && /\bNOT\s+NULL\b/i.test(part) && !/\bDEFAULT\b/i.test(part),
      )
    )
      hits.push('not-null-no-default');

    if (/\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i.test(statement)) hits.push('type-change');

    if (
      topLevelParts(statement).some(
        (part) =>
          /\bADD\s+CONSTRAINT\b/i.test(part) &&
          /\b(?:CHECK|FOREIGN\s+KEY)\b/i.test(part) &&
          !/\bNOT\s+VALID\b/i.test(part),
      )
    )
      hits.push('constraint-scan');
  }

  if (/\bALTER\s+(?:TABLE|INDEX|SEQUENCE|TYPE|VIEW|SCHEMA)\b[\s\S]*\bRENAME\b/i.test(statement))
    hits.push('rename');

  const dmlTarget = matchRef(
    statement,
    String.raw`^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+(?:ONLY\s+)?`,
  );
  if (
    /^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i.test(statement) &&
    isExisting(dmlTarget, existingTables)
  )
    hits.push('backfill');

  return hits;
}

/** The waivers a migration carries, and the findings for the ones that cannot be trusted. */
function readWaivers(tag, waivers) {
  const waived = new Set();
  const findings = [];
  for (const [rule, reason] of Object.entries(waivers)) {
    if (!(rule in RULES))
      findings.push(
        finding('lint', 'unknown-waiver', `waivers.json waives "${rule}" on ${tag}, which is not a rule`, {
          tag,
        }),
      );
    else if (String(reason).trim().length < MIN_REASON)
      findings.push(
        finding(
          'lint',
          'waiver-reason',
          `waivers.json waives ${rule} on ${tag} with "${reason}": say why this is safe on a live database`,
          { tag },
        ),
      );
    else waived.add(rule);
  }
  return { waived, findings };
}

export function lintMigration({ tag, sql, existingTables, waivers = {} }) {
  const { waived, findings } = readWaivers(tag, waivers);
  const created = createdTables(sql);
  const known = new Set([...existingTables, ...created]);
  const used = new Set();

  for (const raw of splitStatements(sql)) {
    const statement = normalize(raw);
    // A table this very migration creates is empty by construction, so nothing done to it can lock
    // out a writer or scan rows that exist.
    const existing = new Set([...known].filter((table) => !created.has(table)));
    for (const rule of ruleHits(statement, existing)) {
      if (waived.has(rule)) {
        used.add(rule);
        continue;
      }
      findings.push(
        finding('lint', rule, `${tag}: ${RULES[rule].summary} Statement: ${statement.slice(0, 160)}`, {
          tag,
        }),
      );
    }
  }

  for (const rule of waived)
    if (!used.has(rule))
      findings.push(
        finding(
          'lint',
          'unused-waiver',
          `waivers.json waives ${rule} on ${tag}, which nothing in that migration trips`,
          { tag },
        ),
      );

  return findings;
}

export const readWaiverFile = (path = WAIVERS_PATH) => JSON.parse(readFileSync(path, 'utf8'));

/** Lints the whole folder, carrying forward the set of tables each migration inherits. */
export function checkLint(dir, waiverPath = WAIVERS_PATH) {
  const findings = [];
  const existingTables = new Set();
  const waiverFile = readWaiverFile(waiverPath);
  for (const migration of loadMigrations(dir)) {
    findings.push(
      ...lintMigration({
        tag: migration.tag,
        sql: migration.sql,
        existingTables,
        waivers: waiverFile[migration.tag] ?? {},
      }),
    );
    for (const table of createdTables(migration.sql)) existingTables.add(table);
    // The snapshot describes the schema after this migration, which covers anything drizzle-kit
    // generated in a form the CREATE TABLE scan above would miss.
    for (const table of Object.keys(migration.snapshot.tables ?? {})) existingTables.add(table.toLowerCase());
  }
  return findings;
}
