// A repository-wide guard against the three Paystack primitives m8 §1/§9 forbids outright. The specs
// name them and explain why: two of them settle to a linked bank account on Paystack's own schedule the
// moment a charge is routed through them, with no documented way to hold the money and release it later,
// which is a hard incompatibility with escrow; the third is a collection mechanism that routes into the
// same problem. Design conflict C8 records what replaces the one screen that implied the third:
// checkout's pay-with-transfer channel, which issues a temporary per-transaction account and settles to
// the main balance.
//
// The guard is strict on purpose: any occurrence in source is a finding, with no escape hatch and no
// allowlist, because an allowlist is the first thing an "I just need this one" change would reach for.
// That is also why the names are assembled from fragments here and in the test, and why the explanation
// above points at the specs instead of spelling them — markdown is not scanned, source is, and a guard
// that has to exempt itself is a guard that can be talked round.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** The forbidden names, assembled so this file is not itself a finding. */
export const FORBIDDEN = {
  sub: ['sub', 'account'].join(''),
  split: ['spl', 'it'].join(''),
  dedicated: ['dedi', 'cated'].join(''),
  /** The three-letter abbreviation for the third primitive. */
  abbreviation: ['D', 'V', 'A'].join(''),
} as const;

export interface ForbiddenPrimitiveFinding {
  /** Path relative to the scanned root. */
  file: string;
  line: number;
  /** One of FORBIDDEN's values. */
  primitive: string;
}

const SEP = '[ _-]?';

const titleCase = (value: string): string => value[0] + value.slice(1).toLowerCase();
/** Shouted, title and lower case — the three spellings an identifier actually takes. */
const ABBREVIATION_CASINGS = [
  FORBIDDEN.abbreviation,
  titleCase(FORBIDDEN.abbreviation),
  FORBIDDEN.abbreviation.toLowerCase(),
];

/**
 * Deliberately narrow on the second and third. A guard that fires on `String.split` or on the word
 * "splitting" in a sentence gets switched off within the week, so each pattern names a Paystack API
 * surface: the parameter, the code, the endpoint, the product name.
 */
const PATTERNS: { primitive: string; pattern: RegExp }[] = [
  { primitive: FORBIDDEN.sub, pattern: new RegExp(`sub${SEP}account`, 'i') },
  { primitive: FORBIDDEN.split, pattern: new RegExp(`${FORBIDDEN.split}${SEP}code`, 'i') },
  {
    primitive: FORBIDDEN.split,
    pattern: new RegExp(`transaction${SEP}${FORBIDDEN.split}s?(?![a-z])`, 'i'),
  },
  {
    primitive: FORBIDDEN.split,
    pattern: new RegExp(`['"\`/]${FORBIDDEN.split}s?(['"\`/?]|$)`, 'i'),
  },
  // The SDK-shaped spellings the endpoint and parameter patterns miss: a create/update verb in front
  // of the name, a pluralised resource accessor, and the usual Group/Config/Type/Id suffixes.
  {
    primitive: FORBIDDEN.split,
    pattern: new RegExp(`(create|update|delete|add|remove)${FORBIDDEN.split}`, 'i'),
  },
  { primitive: FORBIDDEN.split, pattern: new RegExp(`\\.${FORBIDDEN.split}s\\b`, 'i') },
  {
    primitive: FORBIDDEN.split,
    pattern: new RegExp(`${FORBIDDEN.split}(Group|Config|Type|Id)`, 'i'),
  },
  {
    primitive: FORBIDDEN.dedicated,
    pattern: new RegExp(`${FORBIDDEN.dedicated}${SEP}(virtual${SEP})?account`, 'i'),
  },
  // The three casings are spelled out rather than using the `i` flag, because under `i` the trailing
  // `(?![a-z])` would also reject an uppercase letter and so miss the camelCase spelling — which is
  // the one most likely to appear in real code.
  {
    primitive: FORBIDDEN.dedicated,
    pattern: new RegExp(`(^|[^A-Za-z])(${ABBREVIATION_CASINGS.join('|')})(?![a-z])`),
  },
  {
    primitive: FORBIDDEN.dedicated,
    pattern: new RegExp(`[a-z](${FORBIDDEN.abbreviation}|${titleCase(FORBIDDEN.abbreviation)})(?![a-z])`),
  },
];

const SCANNED = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.cjs',
  '.js',
  '.jsx',
  '.vue',
  '.svelte',
  '.json',
  '.sql',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.py',
  '.graphql',
  '.prisma',
  '.example',
]);
/** `.env`, `.env.local`, `Dockerfile` — config with no extension to key on. */
const SCANNED_NAMES = new Set(['Dockerfile', 'Makefile']);
const isScanned = (name: string): boolean =>
  SCANNED.has(path.extname(name)) || SCANNED_NAMES.has(name) || name.startsWith('.env');
/** Markdown is not scanned: the specs and the tickets discuss these primitives by name, as they must. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.turbo',
  '.claude',
  '.vercel',
]);

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* walk(full);
    } else if (isScanned(entry.name)) {
      yield full;
    }
  }
}

/** Every mention of a forbidden Paystack primitive in the source under `root`. */
export async function findForbiddenPaystackPrimitives(root: string): Promise<ForbiddenPrimitiveFinding[]> {
  const findings: ForbiddenPrimitiveFinding[] = [];

  for await (const file of walk(root)) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(root, file);
    source.split('\n').forEach((text, index) => {
      for (const { primitive, pattern } of PATTERNS) {
        if (pattern.test(text)) findings.push({ file: relative, line: index + 1, primitive });
      }
    });
  }

  return findings;
}
