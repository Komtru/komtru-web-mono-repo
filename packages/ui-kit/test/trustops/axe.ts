import axe, { type AxeResults, type Result, type RunOptions } from 'axe-core';

/**
 * The accessibility check every TrustOps pattern's test ends with. T-014 lists it as an acceptance
 * criterion rather than a nicety, because the one thing these patterns exist to guarantee — that
 * advice and action are separable — is a property of the accessibility tree, not of the pixels.
 *
 * `best-practice` is on for `landmark-unique`, which is what notices two landmarks sharing a name.
 * Two neighbouring rules are deliberately *not* relied on, because they do not run here:
 * `landmark-complementary-is-top-level` is tagged `deprecated` in axe-core 4.14 and a tag-based run
 * skips it, and `region` is page-level, so it reports `inapplicable` against a scoped container.
 * The page-level rules are covered instead by the one whole-document run in `CaseLayout.test.tsx`.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

/**
 * `color-contrast` is the one rule turned off. It needs a painted box to sample, and jsdom paints
 * nothing — every element reports a zero-size rect and every colour resolves to the initial value,
 * so the rule either reports nothing or reports nonsense. Contrast is a token-pair property and is
 * held by `tokens.test.ts` and the visual check instead.
 */
const DISABLED: Record<string, { enabled: boolean }> = { 'color-contrast': { enabled: false } };

export interface AxeOptions {
  /** Merged over the defaults, so a test can switch one more rule off with a reason beside it. */
  rules?: Record<string, { enabled: boolean }>;
  /** Narrows the run to specific rule ids, for a test that is about one rule in particular. */
  runOnly?: string[];
  /**
   * Rule ids allowed to land in axe's `incomplete` bucket. Empty by default and meant to stay that
   * way: "needs review" is where jsdom-ambiguous results go, and it is also where a real failure
   * goes when axe cannot finish deciding — `duplicate-id-aria` on two panels sharing an id reported
   * `incomplete`, not `violation`, and ignoring the bucket is what let that through a whole suite.
   */
  allowIncomplete?: string[];
}

function render(results: Result[]): string {
  return results
    .map((result) => {
      const nodes = result.nodes
        // The selector alone is often `div` or `img`; the markup is what tells you which one.
        .map(
          (node) =>
            `      ${node.target.join(' ')}\n      ${node.html}\n        ${node.failureSummary ?? ''}`,
        )
        .join('\n');
      return `  ${result.id} (${result.impact ?? 'unknown'}): ${result.help}\n${nodes}`;
    })
    .join('\n');
}

/** Runs axe over `container` and throws with every problem spelled out when there are any. */
export async function expectNoAxeViolations(container: Element, options: AxeOptions = {}): Promise<void> {
  const run: RunOptions = {
    rules: { ...DISABLED, ...options.rules },
    ...(options.runOnly === undefined
      ? { runOnly: { type: 'tag', values: TAGS } }
      : { runOnly: { type: 'rule', values: options.runOnly } }),
  };
  const results: AxeResults = await axe.run(container, run);
  const allowed = new Set(options.allowIncomplete ?? []);
  const incomplete = results.incomplete.filter((result) => !allowed.has(result.id));

  const parts: string[] = [];
  if (results.violations.length > 0) {
    parts.push(`axe found ${results.violations.length} violation(s):\n${render(results.violations)}`);
  }
  if (incomplete.length > 0) {
    parts.push(
      `axe could not clear ${incomplete.length} check(s) — "needs review" is not "passed":\n` +
        `${render(incomplete)}`,
    );
  }
  if (parts.length > 0) throw new Error(parts.join('\n'));
}

/**
 * Which bucket a rule landed in. Used to prove that a page-scope run really evaluates the page-level
 * rules — `region` reports `inapplicable` against a scoped container, so asserting it "passed" there
 * would be asserting nothing.
 */
export async function axeOutcome(
  container: Element,
  ruleId: string,
): Promise<'violations' | 'passes' | 'incomplete' | 'inapplicable'> {
  const results = await axe.run(container, { runOnly: { type: 'rule', values: [ruleId] } });
  for (const bucket of ['violations', 'passes', 'incomplete'] as const) {
    if (results[bucket].some((result) => result.id === ruleId)) return bucket;
  }
  return 'inapplicable';
}

/** Only used by `axe.test.tsx`, to prove the helper is reading the configuration it claims to. */
export const axeConfiguration = { tags: TAGS, disabled: Object.keys(DISABLED) } as const;
