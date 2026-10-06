// Cannibalized from kumtru/backend-apis/src/modules/identity/domain/username/skeleton.ts (T-001),
// adapted: `skeletonNarrow` is exported (reserved matching has to fold both sides, not just the
// candidate — see reserved.ts), and `collapseRuns` compares code points rather than the last UTF-16
// code unit, which it never matched for an astral character.
/**
 * Confusable folding for usernames (M1 §6.3) — the difference between a username system and a fraud
 * surface.
 *
 * On a platform where a buyer confirms a counterparty by reading a handle, `@dellstore_ng` versus
 * `@dellst0re_ng` is an attack, not a typo. Every username is stored alongside its *skeleton*, and
 * `users.username_skeleton` carries a UNIQUE constraint — so the second of any two confusable handles
 * simply cannot be created.
 *
 * Two properties this module must keep:
 *
 *  1. **Deterministic.** The same input always folds to the same output for a given version. No
 *     locale sensitivity, no randomness, no dependence on the surrounding text.
 *  2. **Versioned per row, not per deploy.** `users.skeleton_version` records which algorithm folded
 *     each stored value. Tightening the algorithm therefore grandfathers existing handles: you run
 *     the new folder in report-only mode over the whole table and hand collisions to Trust & Safety,
 *     rather than mass-renaming users and breaking every link that pointed at them.
 *
 * The folding is deliberately aggressive and *will* reject some legitimate handles. That trade is
 * intentional: the false-positive cost is a mildly annoyed user, the false-negative cost is a
 * defrauded one.
 */

/** The version new claims are folded with. Adding v2 must never change v1's output. */
export const CURRENT_SKELETON_VERSION = 1;

/** Separators are meaningless for identity purposes: `jane.doe`, `jane_doe` and `janedoe` are one name. */
const SEPARATORS = /[._]/g;

/**
 * Combining marks left behind by NFD decomposition, so `é` folds to `e`.
 *
 * `\p{M}` rather than a literal character class: a hand-written class of combining characters is both
 * incomplete and, because the characters combine with the preceding one in a source file, unreadable
 * and easy to corrupt on edit.
 */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Single-character confusables mapped to a canonical ASCII representative.
 *
 * The digit rows are the Komtru overlay from §6.3 and are the ones that matter commercially — leet
 * substitution is how impersonation of a Nigerian storefront handle actually happens. The Cyrillic
 * and Greek rows are the UTS #39 homoglyph classes: launch policy rejects non-ASCII usernames
 * outright, but the reserved-word list is matched on the *skeleton*, so folding them anyway is what
 * makes one `admin` row also catch `аdmin` with a Cyrillic а.
 */
const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  // Komtru digit overlay
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',

  // Latin lookalikes that survive NFKC and diacritic stripping
  ı: 'i',
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ƀ: 'b',
  ɡ: 'g',
  ʀ: 'r',
  '|': 'l',
  '!': 'i',
  $: 's',
  '@': 'a',

  // Cyrillic
  а: 'a',
  в: 'b',
  с: 'c',
  ԁ: 'd',
  е: 'e',
  һ: 'h',
  н: 'h',
  і: 'i',
  ј: 'j',
  к: 'k',
  м: 'm',
  о: 'o',
  р: 'p',
  ѕ: 's',
  т: 't',
  у: 'y',
  х: 'x',
  ѡ: 'w',

  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  σ: 'o',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ω: 'w',
});

/**
 * Multi-character confusables — glyph *pairs* that read as a single letter in most sans-serif fonts.
 * Applied after the single-character pass so `c1othing` reaches `clothing` and then `dothing`, and
 * before run collapsing so `vv` becomes one `w` rather than two.
 */
const MULTIGRAPHS: readonly (readonly [string, string])[] = Object.freeze([
  ['rn', 'm'],
  ['vv', 'w'],
  ['cl', 'd'],
  ['ii', 'u'],
]);

const stripDiacritics = (value: string): string => value.normalize('NFD').replace(COMBINING_MARKS, '');

const mapSingleCharacters = (value: string): string =>
  Array.from(value)
    .map((character) => CONFUSABLES[character] ?? character)
    .join('');

/**
 * One left-to-right pass in declaration order. Every pattern is two characters, so there is no
 * longest-match question. Not iterated to a fixed point: that is unstable under small edits.
 */
const mapMultigraphs = (value: string): string => {
  let out = '';
  let index = 0;

  outer: while (index < value.length) {
    for (const [pattern, replacement] of MULTIGRAPHS) {
      if (value.startsWith(pattern, index)) {
        out += replacement;
        index += pattern.length;
        continue outer;
      }
    }

    out += value[index];
    index += 1;
  }

  return out;
};

/**
 * `daaave` -> `dave`. Aggressive by design: `dellstoreee` must not coexist with `dellstore`.
 *
 * The previous code point is carried in a variable rather than read back off the tail of `out`:
 * `for…of` yields code points while `out[out.length - 1]` is a UTF-16 code unit, so a run of astral
 * characters compared a two-unit code point against one low surrogate and never collapsed.
 */
const collapseRuns = (value: string): string => {
  let out = '';
  let previous: string | undefined;

  for (const character of value) {
    if (character !== previous) out += character;
    previous = character;
  }

  return out;
};

const skeletonV1 = (username: string): string => {
  const normalised = stripDiacritics(username.normalize('NFKC').toLowerCase());
  const withoutSeparators = normalised.replace(SEPARATORS, '');

  return collapseRuns(mapMultigraphs(mapSingleCharacters(withoutSeparators)));
};

/**
 * Registered algorithms, keyed by version.
 *
 * A new version is a NEW entry. Never edit an existing one — every `username_skeleton` in the
 * database was produced by the entry matching its row's `skeleton_version`, and rewriting history
 * here silently invalidates the UNIQUE constraint that protects the namespace.
 */
const ALGORITHMS: Readonly<Record<number, (username: string) => string>> = Object.freeze({
  1: skeletonV1,
});

export const isKnownSkeletonVersion = (version: number): boolean =>
  Object.prototype.hasOwnProperty.call(ALGORITHMS, version);

/**
 * Folds `username` to its confusable skeleton.
 *
 * @param version Which algorithm to use. Defaults to the current one; pass a stored
 *                `skeleton_version` to reproduce an existing row's value exactly.
 */
export const skeleton = (username: string, version: number = CURRENT_SKELETON_VERSION): string => {
  const algorithm = ALGORITHMS[version];

  if (!algorithm) {
    throw new Error(`Unknown skeleton algorithm version ${version}`);
  }

  return algorithm(username);
};

/** True when two handles collide under the current algorithm — i.e. only one of them may exist. */
export const isConfusable = (a: string, b: string, version: number = CURRENT_SKELETON_VERSION): boolean =>
  skeleton(a, version) === skeleton(b, version);

// ---------------------------------------------------------------------------
// Narrow-glyph variant — for reserved-word matching only
// ---------------------------------------------------------------------------

/**
 * `i`, `l`, `1`, `|` and `!` are one visual class in most sans-serif fonts, but they CANNOT be folded
 * together in the canonical skeleton: doing so would fold `dellstore` to `deistore`, and §6.3 fixes
 * that handle's skeleton at `delstoreng`. The canonical algorithm has to stay exactly as specified,
 * because it backs a UNIQUE constraint and every stored row was produced by it.
 *
 * Reserved-word matching is a lookup rather than a constraint, so it can afford to check more than
 * one fold.
 */
const NARROW_GLYPH_CLASS: Readonly<Record<string, string>> = Object.freeze({
  l: 'i',
  '1': 'i',
  '|': 'i',
  '!': 'i',
});

const mapNarrowGlyphs = (value: string): string =>
  Array.from(value)
    .map((character) => NARROW_GLYPH_CLASS[character] ?? character)
    .join('');

/** NFKC, lowercase, diacritics stripped, separators removed, single-character confusables mapped. */
const prepare = (username: string): string =>
  mapSingleCharacters(stripDiacritics(username.normalize('NFKC').toLowerCase()).replace(SEPARATORS, ''));

/**
 * The i/l/1 fold alone. `narrow('adm1n')` is `admin` where `skeleton('adm1n')` is `admln`.
 *
 * Unversioned on purpose: it never produces a stored value, so there is nothing to grandfather. The
 * `version` that `skeletonVariants` takes applies to the canonical fold, which does back a column.
 */
export const skeletonNarrow = (username: string): string => collapseRuns(mapNarrowGlyphs(prepare(username)));

/**
 * The two optional passes — multigraphs (`rn→m`, `vv→w`, `cl→d`, `ii→u`) and the narrow glyph class
 * — applied alone and in both orders.
 *
 * They are two independent axes, not a pair, and that is the whole point. The lifted code checked
 * only the ends of each axis, so a handle using ONE substitution from EACH class landed between
 * them and matched neither stored fold:
 *
 *     'adrn1n'  canonical 'admln'   narrow 'adrnin'   reserved 'admin' → not caught
 *     'vvailet' canonical 'wailet'  narrow 'vaiet'    reserved 'wallet' → not caught
 *
 * Composing them closes that gap: `narrow(multigraph('adrn1n'))` is `admin`. Both orders are needed
 * because the passes interact — the narrow pass creates the `ii` that the multigraph pass folds to
 * `u`, and the multigraph pass consumes the `l` of `cl` that the narrow pass would have turned into
 * an `i`.
 */
const EXTRA_PASSES: readonly ((value: string) => string)[] = Object.freeze([
  mapNarrowGlyphs,
  (value: string) => mapMultigraphs(mapNarrowGlyphs(value)),
  (value: string) => mapNarrowGlyphs(mapMultigraphs(value)),
]);

/**
 * Every fold a candidate should be checked against when testing the reserved namespace.
 *
 * The canonical skeleton is always first, so a caller that only looks at `[0]` still gets the value
 * that belongs in `username_skeleton`. Deduplicated, because for most handles the folds agree.
 *
 * **Both sides of a reserved-word comparison must go through this.** The lifted code folded only the
 * candidate and compared it against the reserved word's *canonical* fold, which leaves
 * `@fiutterwave` claimable beside a reserved `@flutterwave` — `narrow('fiutterwave')` is
 * `fiuterwave` and `skeleton('flutterwave')` is `fluterwave`, so neither fold ever meets the other.
 */
export const skeletonVariants = (username: string, version: number = CURRENT_SKELETON_VERSION): string[] => {
  const folds = new Set([skeleton(username, version)]);
  const base = prepare(username);

  for (const pass of EXTRA_PASSES) folds.add(collapseRuns(pass(base)));

  return [...folds];
};
