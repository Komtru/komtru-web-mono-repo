// Design §6.5: "A test fails if ledger, trades, park or merchant code contains a numeric literal
// equal to any value in the fee file, or imports fees from anywhere except the fee module."
//
// A second, deliberately independent check, like apps/backend-api/test/support/provider-imports.ts:
// it reads the source text rather than the ESLint config, so it is what still fails if
// komtru/module-boundaries is disabled, renamed, or silenced with a disable comment.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

export interface FeeGuardViolation {
  /** Path relative to the scanned root. */
  file: string;
  line: number;
  /** The offending literal or imported symbol. */
  detail: string;
  kind: 'fee-literal' | 'fee-read-bypass';
}

/** The module that owns the fee file; everything here is its job, so it is exempt. */
const FEE_MODULE = 'config';

/**
 * Fee reads that go round the module. `computeTradeFees` and friends belong to the fee module and to
 * a trade's snapshot: ledger and trades code must post from the snapshot, never recompute from the
 * live file, or a fee change would retroactively alter an open trade.
 */
const FORBIDDEN_SYMBOLS = new Set([
  'computeTradeFees',
  'snapshotFees',
  'snapshotParkCashFee',
  'parseFeeSchedule',
  'feeScheduleSchema',
  'getFeeSchedule',
]);

/** Below this a value is indistinguishable from an array index or a loop bound. */
const DISTINCTIVE = 10;

const SHARED_TYPES = /import\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]@komtru\/shared-types['"]/g;
/** A whole numeric token, tolerating `_` separators and a bigint `n` suffix; not part of an identifier. */
const NUMBER = /(?<![\w$.])\d[\d_]*n?(?![\w$.])/g;

/** Every scalar leaf of the fee file, flattened. */
function leaves(value: unknown, into: unknown[] = []): unknown[] {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) leaves(child, into);
  } else {
    into.push(value);
  }
  return into;
}

/**
 * The values worth guarding: every number of at least two digits, plus the schedule's `version`.
 * `0`, the booleans and `NGN` are left out — a guard that fires on a `0` in a loop bound gets turned
 * off within a week, and the module boundary is what covers the values too small to recognise.
 */
export function feeValuesToGuard(scheduleText: string): string[] {
  const file = parse(scheduleText) as { version?: unknown };
  const values = new Set<string>();
  for (const leaf of leaves(file)) {
    if (typeof leaf === 'number' && Number.isFinite(leaf) && Math.abs(leaf) >= DISTINCTIVE) {
      values.add(String(leaf));
    }
  }
  if (typeof file.version === 'string') values.add(file.version);
  return [...values];
}

/**
 * Blanks out comments, keeping every other character in place so line numbers and offsets still
 * line up. A fee value named in a comment decides nothing, and an import that is commented out is
 * not an import; both would otherwise be false positives.
 */
function stripComments(source: string): string {
  const out = [...source];
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  while (index < source.length) {
    const char = source[index]!;
    if (char === '"' || char === "'" || char === '`') {
      index += 1;
      while (index < source.length && source[index] !== char) {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
    } else if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      blank(index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
    } else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      blank(index, end === -1 ? source.length : end + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      index += 1;
    }
  }
  return out.join('');
}

const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length;

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

/** Scans a backend module tree (`src/modules`) for fee literals and fee reads that skip the module. */
export async function findFeeViolations(root: string, values: string[]): Promise<FeeGuardViolation[]> {
  const numeric = new Set(values.filter((value) => /^\d+$/.test(value)));
  const textual = values.filter((value) => !/^\d+$/.test(value));
  const violations: FeeGuardViolation[] = [];

  for await (const file of walk(root)) {
    const relative = path.relative(root, file);
    if (relative.split(path.sep)[0] === FEE_MODULE) continue;
    const source = stripComments(await readFile(file, 'utf8'));
    const at = (index: number) => ({ file: relative, line: lineAt(source, index) });

    for (const match of source.matchAll(NUMBER)) {
      const value = match[0].replaceAll('_', '').replace(/n$/, '');
      if (numeric.has(value)) {
        violations.push({ ...at(match.index), detail: value, kind: 'fee-literal' });
      }
    }
    for (const value of textual) {
      const index = source.indexOf(value);
      if (index !== -1) violations.push({ ...at(index), detail: value, kind: 'fee-literal' });
    }

    const yaml = source.indexOf('fees.yaml');
    if (yaml !== -1) {
      violations.push({ ...at(yaml), detail: 'config/fees.yaml', kind: 'fee-read-bypass' });
    }
    for (const match of source.matchAll(SHARED_TYPES)) {
      const clause = match[1] ?? '';
      // A namespace import hides which symbols are used, so the whole file is checked for them.
      const scope = /^\*\s+as\s/.test(clause.trim()) ? source : clause;
      for (const symbol of FORBIDDEN_SYMBOLS) {
        if (new RegExp(`(?<![\\w$])${symbol}(?![\\w$])`).test(scope)) {
          violations.push({ ...at(match.index), detail: symbol, kind: 'fee-read-bypass' });
        }
      }
    }
  }

  return violations;
}
