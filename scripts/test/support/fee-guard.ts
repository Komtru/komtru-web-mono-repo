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
]);

/**
 * Modules that must post from a trade's stored snapshot. Reading the *live* schedule here — even
 * through the sanctioned barrel — recomputes a fee for an already-accepted trade, which is the
 * retroactive-repricing bug the snapshot exists to prevent. A quote endpoint would be a legitimate
 * caller; none of these are.
 */
const SNAPSHOT_ONLY = ['ledger', 'trades', 'park', 'merchant'];
const LIVE_READS = ['getFeeSchedule', 'applyBps'];

/** Below this a value is indistinguishable from an array index or a loop bound. */
const DISTINCTIVE = 10;

/** `// fee-guard-ignore: <reason>` on the line, for a constant that genuinely is not a fee. */
export const IGNORE_MARKER = 'fee-guard-ignore';

/**
 * A guarded number is a fee literal unless its line is plainly about something else. `30000` is a
 * fee cap AND the most ordinary 30-second timeout there is; flagging every one would get the guard
 * switched off, and missing every one would make it useless. So: guard by default, and exclude the
 * units that are unmistakably not money. A missed fee literal costs more than a noisy one, which is
 * why this is a short denylist rather than a long allowlist.
 */
const NOT_MONEY =
  /(?<![a-z])(ms|millis|milliseconds?|seconds?|secs?|minutes?|hours?|days?|timeout|ttl|delay|interval|poll|backoff|retry|retries|attempts?|port|offset|index|length|size|bytes?|width|height|px|limit|concurrency|depth)(?![a-z])/i;

/** `import … from`, `export … from`, `require(…)` and `await import(…)` all reach the package. */
const SHARED_TYPES =
  /(?:import|export)\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]@komtru\/shared-types['"]|(?:require|import)\(\s*['"]@komtru\/shared-types['"]\s*\)/g;
/** A relative path into the fee module that is not its barrel: the deep import the barrel forbids. */
const DEEP_CONFIG_IMPORT = /['"][^'"]*\/config\/(?!index)[^'"]*['"]/g;
/** The file itself, however the path is spelled. */
const FEES_FILE_MENTION = /fees\.ya?ml/gi;
/** A whole numeric token, tolerating `_` separators and a bigint `n` suffix; not part of an identifier. */
const NUMBER = /(?<![\w$.])\d[\d_]*n?(?![\w$.])/g;
/** A decimal fraction, for a rate written as `0.015` or `1.5` rather than in basis points. */
const DECIMAL = /(?<![\w$.])\d+\.\d+(?![\w$.])/g;

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
 * Each basis-point rate as the decimal fractions someone would write instead: 150 bps is `0.015` as
 * a multiplier and `1.5` as a percentage. Both are a fee literal AND a float in a money path.
 */
export function feeFractionsToGuard(scheduleText: string): string[] {
  const fractions = new Set<string>();
  for (const [key, value] of flatten(parse(scheduleText))) {
    if (key.endsWith('rate_bps') && typeof value === 'number' && value > 0) {
      fractions.add(String(value / 10_000));
      fractions.add(String(value / 100));
    }
  }
  return [...fractions];
}

/** Dotted key to scalar, for the rate lookup above. */
function flatten(value: unknown, prefix = '', into: [string, unknown][] = []): [string, unknown][] {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into);
    }
  } else {
    into.push([prefix, value]);
  }
  return into;
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
export async function findFeeViolations(
  root: string,
  values: string[],
  decimalRates: string[] = [],
): Promise<FeeGuardViolation[]> {
  const numeric = new Set(values.filter((value) => /^\d+$/.test(value)));
  const textual = values.filter((value) => !/^\d+$/.test(value));
  const fractions = new Set(decimalRates);
  const violations: FeeGuardViolation[] = [];

  for await (const file of walk(root)) {
    const relative = path.relative(root, file);
    if (relative.split(path.sep)[0] === FEE_MODULE) continue;
    const source = stripComments(await readFile(file, 'utf8'));
    const at = (index: number) => ({ file: relative, line: lineAt(source, index) });

    const lines = source.split('\n');
    const lineOf = (index: number) => lines[lineAt(source, index) - 1] ?? '';
    // Comments are blanked before this runs, so the opt-out is read from the raw source. A guard
    // with no escape hatch gets deleted the first time it fires on a legitimate constant.
    const raw = (await readFile(file, 'utf8')).split('\n');
    const ignored = (index: number) => (raw[lineAt(source, index) - 1] ?? '').includes(IGNORE_MARKER);

    for (const match of source.matchAll(NUMBER)) {
      const value = match[0].replaceAll('_', '').replace(/n$/, '');
      if (numeric.has(value) && !NOT_MONEY.test(lineOf(match.index)) && !ignored(match.index)) {
        violations.push({ ...at(match.index), detail: value, kind: 'fee-literal' });
      }
    }
    // The same rate written as a decimal fraction: `Math.round(amount * 0.015)` is exactly how
    // someone reimplements 1.5%, and it is a float in a money path as well as a fee literal.
    for (const match of source.matchAll(DECIMAL)) {
      if (fractions.has(match[0]) && !NOT_MONEY.test(lineOf(match.index)) && !ignored(match.index)) {
        violations.push({ ...at(match.index), detail: match[0], kind: 'fee-literal' });
      }
    }
    for (const value of textual) {
      // A token-boundary search: `indexOf` would report version 2026-10-05.10 as 2026-10-05.1.
      const token = new RegExp(`(?<![\\w.-])${value.replaceAll('.', '\\.')}(?![\\w.-])`);
      const found = token.exec(source);
      if (found) violations.push({ ...at(found.index), detail: value, kind: 'fee-literal' });
    }

    for (const match of source.matchAll(FEES_FILE_MENTION)) {
      violations.push({ ...at(match.index), detail: 'config/fees.yaml', kind: 'fee-read-bypass' });
    }
    for (const match of source.matchAll(DEEP_CONFIG_IMPORT)) {
      violations.push({ ...at(match.index), detail: match[0], kind: 'fee-read-bypass' });
    }
    if (SNAPSHOT_ONLY.includes(relative.split(path.sep)[0] ?? '')) {
      for (const symbol of LIVE_READS) {
        const used = new RegExp(`(?<![\\w$])${symbol}(?![\\w$])`).exec(source);
        if (used) violations.push({ ...at(used.index), detail: symbol, kind: 'fee-read-bypass' });
      }
    }
    for (const match of source.matchAll(SHARED_TYPES)) {
      const clause = match[1];
      // A namespace import, a require() and a dynamic import() all hide which symbols are used, so
      // the whole file is the scope.
      const scope = clause === undefined || /^\*\s+as\s/.test(clause.trim()) ? source : clause;
      for (const symbol of FORBIDDEN_SYMBOLS) {
        if (new RegExp(`(?<![\\w$])${symbol}(?![\\w$])`).test(scope)) {
          violations.push({ ...at(match.index), detail: symbol, kind: 'fee-read-bypass' });
        }
      }
    }
  }

  return violations;
}
