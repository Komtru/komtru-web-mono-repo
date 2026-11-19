// A guard against the three Paystack primitives m8 §1/§9 forbids outright. The specs
// name them and explain why: two of them settle to a linked bank account on Paystack's own schedule the
// moment a charge is routed through them, with no documented way to hold the money and release it later,
// which is a hard incompatibility with escrow; the third is a collection mechanism that routes into the
// same problem. Design conflict C8 records what replaces the one screen that implied the third:
// checkout's pay-with-transfer channel, which issues a temporary per-transaction account and settles to
// the main balance.
//
// The guard is strict on purpose: any occurrence in source is a finding, with no escape hatch and no
// per-line allowlist, because an allowlist is the first thing an "I just need this one" change would
// reach for. That is also why the names are assembled from fragments here and in the test, and why the
// explanation above points at the specs instead of spelling them — markdown is not scanned, source is,
// and a guard that has to exempt itself is a guard that can be talked round.
//
// What it does not do any more is walk the whole repository. The endpoint pattern matches the second
// primitive inside any pair of quotes or slashes, which is the right shape for a URL path and also
// the exact shape of a CSS class in JSX — so the marketing site's two-column layout class read as a
// finding and blocked staging. The scope is now the trees where a payment can actually be initiated —
// see MONEY_TREES, which is the one knob and is a list of directories, not of permitted lines.
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
  // Gitignored but present the moment anyone runs `build-storybook`, and thousands of generated
  // files the guard has no opinion about.
  'storybook-static',
  '.vercel',
]);

async function* walkAll(dirs: readonly string[]): AsyncGenerator<string> {
  for (const dir of dirs) yield* walk(dir);
}

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

/**
 * The trees a charge can be built or sent from, and so the trees this guard walks.
 *
 * Membership is "can this code reach Paystack", not "is this the backend". `web-app-ui` is here
 * because it runs Paystack Inline in the browser (`src/trade/funding/checkout.ts`) — it is the one
 * frontend that initiates a payment, and leaving it out would put the guard's blind spot exactly
 * where a client-side charge would be written. The other four apps are TrustOps, courier, custody
 * and marketing: no payment path, and markup full of words like the second primitive.
 *
 * Adding a payment path to a tree that is not listed here means adding it here in the same commit.
 */
export const MONEY_TREES = [
  // The API that holds the money and talks to the provider.
  'apps/backend-api',
  // Paystack Inline, in the buyer's browser.
  'apps/web-app-ui',
  // The typed client both of the above speak through, including its Inline port.
  'packages/api-client',
  // Session and route wiring the payment screens are mounted on.
  'packages/app-kit',
  // The money shapes themselves.
  'packages/shared-types',
  // Fee schedule and the tools that read it.
  'config',
  'tools',
] as const;

/**
 * Every mention of a forbidden Paystack primitive in the source under `root`.
 *
 * `trees` limits the walk to those subdirectories of `root`; omitting it walks everything, which is
 * what the fixture tests do. A tree that does not exist is skipped silently — `walk` already treats
 * an unreadable directory as empty — so the repository case guards against that separately by
 * asserting the trees are there before it trusts an empty result.
 */
export async function findForbiddenPaystackPrimitives(
  root: string,
  trees?: readonly string[],
): Promise<ForbiddenPrimitiveFinding[]> {
  const findings: ForbiddenPrimitiveFinding[] = [];
  const roots = trees?.length ? trees.map((tree) => path.join(root, tree)) : [root];

  for await (const file of walkAll(roots)) {
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
