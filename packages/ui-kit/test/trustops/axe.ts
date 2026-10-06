import axe, { type AxeResults, type RunOptions } from 'axe-core';

/**
 * The accessibility check every TrustOps pattern's test ends with. T-014 lists it as an acceptance
 * criterion rather than a nicety, because the one thing these patterns exist to guarantee — that
 * advice and action are separable — is a property of the accessibility tree, not of the pixels.
 *
 * `best-practice` is on deliberately: `region`, `landmark-unique` and
 * `landmark-complementary-is-top-level` are all best-practice rules, and they are exactly the rules
 * that notice when two landmarks collapse into one or share a name.
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
}

function describe(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const nodes = violation.nodes
        // The selector alone is often `div` or `img`; the markup is what tells you which one.
        .map(
          (node) =>
            `      ${node.target.join(' ')}\n      ${node.html}\n        ${node.failureSummary ?? ''}`,
        )
        .join('\n');
      return `  ${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${nodes}`;
    })
    .join('\n');
}

/** Runs axe over `container` and throws with every violation spelled out when there are any. */
export async function expectNoAxeViolations(container: Element, options: AxeOptions = {}): Promise<void> {
  const run: RunOptions = {
    rules: { ...DISABLED, ...options.rules },
    ...(options.runOnly === undefined ? { runOnly: { type: 'tag', values: TAGS } } : {}),
    ...(options.runOnly === undefined ? {} : { runOnly: { type: 'rule', values: options.runOnly } }),
  };
  const results = await axe.run(container, run);
  if (results.violations.length > 0) {
    throw new Error(`axe found ${results.violations.length} violation(s):\n${describe(results)}`);
  }
}

/** Only used by `axe.test.tsx`, to prove the helper is reading the configuration it claims to. */
export const axeConfiguration = { tags: TAGS, disabled: Object.keys(DISABLED) } as const;
