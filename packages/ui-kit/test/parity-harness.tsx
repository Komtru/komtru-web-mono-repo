/**
 * The runner behind `primitives-parity.test.tsx`, `trustops-parity.test.tsx` and
 * `shells-parity.test.tsx`.
 *
 * T-012 built this inline; T-014 needed the same checks for the TrustOps patterns, and two copies of
 * a rule like "a DEVIATIONS entry that no longer deviates is a failure" would drift the first time
 * one of them was tightened. The tables stay with the components they describe; the rules live here.
 *
 * T-013 added the width. A primitive's reference rule is unconditional, so reading it and the
 * compiled utilities with no viewport in mind is correct for one. A shell's is not — `.dweb-content`
 * is 24px of padding and `.tweb-content` 20px on the same element — so a row may name the width to
 * resolve both sides at, and a suite may hand the runner a width-aware reader. Neither is required,
 * and with neither the runner behaves exactly as it did before.
 *
 * Node, not jsdom: under jsdom Vite rewrites `import.meta.url` into a `/@fs` URL, which breaks both
 * the reference-file read and Tailwind's stylesheet resolution. `react-dom/server` needs no DOM.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  canonicalise,
  compiledDeclarations,
  expandDeclaration,
  referenceInlineStyle,
  referenceRule,
} from './reference-css.js';

/** What a list of classes computes to. `shells-parity` hands in the width-aware reader. */
export type DeclarationReader = (classNames: string[], width: number) => Promise<Map<string, string>>;

export interface ParityRow {
  /** Key into `deviations`/`additions`, and the name the failure is reported under. */
  id: string;
  /** The selector the reference HTML declares for this piece of markup. */
  selector: string;
  /**
   * The rules `selector` modifies. `.chip.protected` declares a colour pair and nothing else; the
   * element carries `.chip` too, so the comparison has to be against both or every base declaration
   * reads as something the component invented.
   */
  extends?: readonly string[];
  /** Rendered, then its class attributes harvested. */
  element?: React.ReactElement;
  /** Which element in the rendered markup carries the class under test. Defaults to the first. */
  node?: number;
  /** Given instead of `element` when the classes are not reachable through a rendered component. */
  classes?: readonly string[];
  /** Set where the reference carries two designs under one class name. */
  styleId?: string;
  /**
   * A `class="…"` whose element carries the state inline. The reference states some states in the
   * markup rather than in a rule, and those are the only statement of them there is.
   */
  inline?: string;
  /**
   * The viewport width to resolve both sides at. Only a shell needs it — a primitive's reference
   * rule carries no media query and its utilities carry no screen variant.
   */
  width?: number;
}

/** Every property a component knowingly does not reproduce, keyed by parity id, with the reason. */
export type Deviations = Record<string, Record<string, string>>;

/** Every property a component applies that its reference rule does not declare, keyed by parity id. */
export type Additions = Record<string, readonly string[]>;

export interface ParitySuite {
  /** The reference document, already read. */
  html: string;
  rows: readonly ParityRow[];
  deviations: Deviations;
  additions: Additions;
  /** Defaults to the width-blind reader, which refuses to resolve a variant at all. */
  declarations?: DeclarationReader;
  /** Used by any row that names no width of its own. */
  defaultWidth?: number;
}

/** The `class` attribute of every element in the rendered markup, in document order. */
export function classAttributes(element: React.ReactElement): string[] {
  return [...renderToStaticMarkup(element).matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1] ?? '');
}

function classesOf(row: ParityRow): string[] {
  if (row.classes !== undefined) return [...row.classes];
  if (row.element === undefined) throw new Error(`${row.id} has neither an element nor a class list`);
  return (classAttributes(row.element)[row.node ?? 0] ?? '').split(/\s+/);
}

/** The declarations the reference gives this row, with its `extends` and inline style folded in. */
function referenceDeclarations(
  html: string,
  row: ParityRow,
  atWidth: { atWidth?: number },
): Map<string, string> {
  const raw = new Map<string, string>();
  for (const selector of [...(row.extends ?? []), row.selector]) {
    for (const [property, value] of referenceRule(html, selector, row.styleId, atWidth)) {
      raw.set(property, value);
    }
  }
  if (row.inline !== undefined) {
    for (const [property, value] of referenceInlineStyle(html, row.inline)) raw.set(property, value);
  }
  return raw;
}

/**
 * Two utilities setting the same property on one element do not layer in the order they are written
 * — the stylesheet decides — so a base and a state branch that both set a background render
 * whichever Tailwind happened to emit last. That is invisible in a class-name assertion and, until
 * the harness learned emission order, invisible in parity too. These are the properties where a
 * second claimant is always a bug rather than Tailwind composing (`border` + `border-dashed` and
 * `m-0` + `mx-[7px]` layer by design, so widths, styles and spacing are deliberately not listed).
 */
const SINGLE_CLAIMANT = [
  'background-color',
  'background-image',
  'color',
  'border-top-color',
  'outline-color',
  'fill',
  'stroke',
  'display',
] as const;

/** Registers every parity check for a suite. Call it at the top level of a `*.test.tsx`. */
export function describeParity({
  html,
  rows,
  deviations,
  additions,
  declarations = (classNames) => compiledDeclarations(classNames),
  defaultWidth,
}: ParitySuite): void {
  /** The width the compiled cascade is resolved at. */
  const widthOf = (row: ParityRow): number => row.width ?? defaultWidth ?? Number.MAX_SAFE_INTEGER;
  /**
   * The width the *reference's* own media queries are read at; absent means "merge every copy",
   * which is right for a rule the reference states unconditionally.
   */
  const referenceWidth = (row: ParityRow): { atWidth?: number } => {
    const width = row.width ?? defaultWidth;
    return width === undefined ? {} : { atWidth: width };
  };

  describe.each(rows)('$id', (row) => {
    const classes = classesOf(row);

    it(`compiles to what the reference declares for ${row.selector}`, async () => {
      const raw = referenceDeclarations(html, row, referenceWidth(row));
      const reference = canonicalise(raw);
      const compiled = await declarations(classes, widthOf(row));
      // A deviation is written against the property the reference declares; widen it to the
      // longhands that property expands into, so excusing `border-radius` does not mean listing
      // four corners.
      const excused = new Map<string, string>();
      for (const [property, reason] of Object.entries(deviations[row.id] ?? {})) {
        for (const [longhand] of expandDeclaration(property, raw.get(property) ?? '0')) {
          excused.set(longhand, reason);
        }
      }

      const mismatches: string[] = [];
      const excusedButMatching: string[] = [];
      for (const [property, expected] of reference) {
        const actual = compiled.get(property);
        if (excused.has(property)) {
          if (actual === expected) excusedButMatching.push(property);
          continue;
        }
        if (actual !== expected) {
          mismatches.push(`${property}: expected "${expected}", compiled "${actual ?? '(absent)'}"`);
        }
      }

      expect(mismatches, `${row.id} drifted from ${row.selector}`).toEqual([]);
      expect(
        excusedButMatching,
        `${row.id} excuses properties it actually reproduces — delete the DEVIATIONS entry`,
      ).toEqual([]);

      // The other direction. Without it the comparison is blind to anything a component *adds*: a
      // `hidden` or `opacity-0` slipped into a class string reproduces every declared property
      // perfectly and still renders nothing.
      const declared = new Set(additions[row.id] ?? []);
      const undeclaredAdditions = [...compiled.keys()].filter(
        (property) => !reference.has(property) && !declared.has(property),
      );
      const staleAdditions = [...declared].filter(
        (property) => !compiled.has(property) || reference.has(property),
      );
      expect(
        undeclaredAdditions,
        `${row.id} applies properties the reference does not — name them in ADDITIONS or drop them`,
      ).toEqual([]);
      expect(staleAdditions, `${row.id} declares additions it no longer applies`).toEqual([]);

      // A `var()` surviving canonicalisation on both sides would compare equal while meaning nothing.
      for (const [property, value] of reference) {
        expect(value, `${row.id} left ${property} unresolved`).not.toContain('var(');
      }
    });

    it('claims each decisive property exactly once', async () => {
      // Keyed by variant as well as property: `hidden` beside `lg:block` is the whole mechanism of
      // a responsive shell, not two rules racing, and only utilities under the same variant can
      // race at a given width.
      const claimants = new Map<string, string[]>();
      for (const utility of classes.filter((name) => name !== '')) {
        const variant = utility.includes(':') ? utility.slice(0, utility.indexOf(':')) : '';
        let compiled: Map<string, string>;
        try {
          compiled = await declarations([utility], widthOf(row));
        } catch {
          continue; // A variant the reader skips and compiles nothing for.
        }
        for (const property of SINGLE_CLAIMANT) {
          if (!compiled.has(property)) continue;
          const key = `${variant}|${property}`;
          claimants.set(key, [...(claimants.get(key) ?? []), utility]);
        }
      }
      const contested = [...claimants]
        .filter(([, utilities]) => utilities.length > 1)
        .map(([key, utilities]) => `${key.split('|')[1] ?? key}: ${utilities.join(' and ')}`);
      expect(contested, `${row.id} lets the stylesheet pick, rather than picking`).toEqual([]);
    });
  });

  describe('DEVIATIONS', () => {
    it('names only components the suite actually checks', () => {
      const ids = new Set(rows.map((row) => row.id));
      expect([...Object.keys(deviations)].filter((id) => !ids.has(id))).toEqual([]);
    });

    it('gives every excused property a reason, not a bare entry', () => {
      for (const [id, properties] of Object.entries(deviations)) {
        for (const [property, reason] of Object.entries(properties)) {
          expect(reason.length, `${id}.${property} needs a real reason`).toBeGreaterThan(40);
        }
      }
    });

    // A misspelled property excuses nothing and is reported by nothing: the mismatch loop never
    // looks it up, and the staleness check only sees properties the reference declares.
    it('names properties the reference actually declares', () => {
      for (const [id, properties] of Object.entries(deviations)) {
        const row = rows.find((candidate) => candidate.id === id);
        if (row === undefined) continue;
        const declared = referenceDeclarations(html, row, referenceWidth(row));
        for (const property of Object.keys(properties)) {
          expect(
            declared.has(property),
            `${id} excuses "${property}", which ${row.selector} never declares`,
          ).toBe(true);
        }
      }
    });
  });

  describe('ADDITIONS', () => {
    it('names only components the suite actually checks', () => {
      const ids = new Set(rows.map((row) => row.id));
      expect(Object.keys(additions).filter((id) => !ids.has(id))).toEqual([]);
    });
  });
}
