// The accessibility check every screen suite in this app ends with. Deliberately a copy of the
// decisions in `packages/app-kit/test/ui/axe.ts` rather than an import of them: reaching into
// another package's test tree would put a file outside this app's `rootDir` into its typecheck.
//
// Two of those decisions are the ones that matter and are repeated verbatim:
//   * `color-contrast` is off — jsdom paints nothing, so the rule reports nonsense or nothing.
//     Contrast is a token-pair property, held by ui-kit's `tokens.test.ts` and the visual check.
//   * the `incomplete` bucket fails the check. "Needs review" is where a real failure goes when
//     axe cannot finish deciding, and ignoring it is how a duplicate-id bug sailed through T-014.
import axe, { type Result } from 'axe-core';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const describeResults = (results: Result[]): string =>
  results
    .map(
      (result) =>
        `  ${result.id} (${result.impact ?? 'unknown'}): ${result.help}\n` +
        result.nodes.map((node) => `      ${node.html}`).join('\n'),
    )
    .join('\n');

/**
 * `disable` is for a rule jsdom cannot answer honestly, never for one a screen fails. Each use names
 * its reason at the call site, the way `color-contrast` is named here.
 */
export async function expectNoAxeViolations(container: Element, disable: string[] = []): Promise<void> {
  const rules: Record<string, { enabled: boolean }> = { 'color-contrast': { enabled: false } };
  for (const rule of disable) rules[rule] = { enabled: false };

  const results = await axe.run(container, { runOnly: { type: 'tag', values: TAGS }, rules });
  const parts: string[] = [];
  if (results.violations.length > 0) parts.push(`violations:\n${describeResults(results.violations)}`);
  if (results.incomplete.length > 0) {
    parts.push(`could not be cleared:\n${describeResults(results.incomplete)}`);
  }
  if (parts.length > 0) throw new Error(parts.join('\n'));
}
