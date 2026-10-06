/**
 * The parity runner, shared by `primitives-parity.test.tsx` and `shells-parity.test.tsx`.
 *
 * A component is only honest if what it compiles to matches what the reference HTML declares for
 * it, so both sides are reduced to the same shape and diffed property by property, in both
 * directions. A property the component does not reproduce has to be named in `deviations` with a
 * reason; a property it applies that the reference does not has to be named in `additions`; and an
 * entry in either that no longer applies fails too, so neither list can rot into a blanket excuse.
 *
 * Node, not jsdom: under jsdom Vite rewrites `import.meta.url` into a `/@fs` URL, which breaks both
 * the reference-file read and Tailwind's stylesheet resolution. `react-dom/server` needs no DOM.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canonicalise, expandDeclaration, referenceInlineStyle, referenceRule } from './reference-css.js';

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
   * The viewport width to resolve the cascade at. Only a shell needs it — a primitive's reference
   * rule is unconditional — and only when the suite passes a width-aware `declarations`.
   */
  width?: number;
}

/** The `class` attribute of every element in the rendered markup, in document order. */
export function classAttributes(element: React.ReactElement): string[] {
  return [...renderToStaticMarkup(element).matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1] ?? '');
}

/** What a list of classes computes to; `shells-parity` passes the width-aware reader. */
export type DeclarationReader = (classNames: string[], width: number) => Promise<Map<string, string>>;

export interface ParitySuite {
  /** The reference document, already read. */
  html: string;
  rows: readonly ParityRow[];
  /** Property → reason, per row id. */
  deviations: Record<string, Record<string, string>>;
  /** The properties a row applies that its reference rule does not declare, per row id. */
  additions: Record<string, readonly string[]>;
  declarations: DeclarationReader;
  /** Used when a row names no width of its own. */
  defaultWidth?: number;
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

export function describeParity(suite: ParitySuite): void {
  const { html, rows, deviations, additions, declarations } = suite;
  /** The width the compiled cascade is resolved at. */
  const widthOf = (row: ParityRow): number => row.width ?? suite.defaultWidth ?? Number.MAX_SAFE_INTEGER;
  /** The width the *reference's* own media queries are read at; absent means "merge every copy". */
  const referenceWidth = (row: ParityRow): { atWidth?: number } => {
    const width = row.width ?? suite.defaultWidth;
    return width === undefined ? {} : { atWidth: width };
  };
  const classesOf = (row: ParityRow): string[] => [
    ...(row.classes ?? (classAttributes(row.element!)[row.node ?? 0] ?? '').split(/\s+/)),
  ];

  describe.each(rows)('$id', (row) => {
    const classes = classesOf(row);

    it(`compiles to what the reference declares for ${row.selector}`, async () => {
      const raw = new Map<string, string>();
      for (const selector of [...(row.extends ?? []), row.selector]) {
        for (const [property, value] of referenceRule(html, selector, row.styleId, referenceWidth(row))) {
          raw.set(property, value);
        }
      }
      if (row.inline !== undefined) {
        for (const [property, value] of referenceInlineStyle(html, row.inline)) raw.set(property, value);
      }
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
      // Keyed by variant as well as property: `hidden` and `lg:block` both claim `display`, and
      // that is the whole mechanism of a responsive shell rather than two rules racing.
      const claimants = new Map<string, string[]>();
      for (const utility of classes.filter((name) => name !== '')) {
        const variant = utility.includes(':') ? utility.slice(0, utility.indexOf(':')) : '';
        let compiled: Map<string, string>;
        try {
          compiled = await declarations([utility], widthOf(row));
        } catch {
          continue; // A variant the width-blind reader skips and compiles nothing for.
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
        const declared = new Map<string, string>();
        for (const selector of [...(row.extends ?? []), row.selector]) {
          for (const [property, value] of referenceRule(html, selector, row.styleId, referenceWidth(row))) {
            declared.set(property, value);
          }
        }
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
