// The walks a ticket can name. Add a row when a screen needs a state the URL alone does not reach. Each
// entry is checked by a test (`test/walkthroughs.test.ts`) against the screen index, so a typo in a screen
// id fails there, not as a wrong screenshot.
import type { Walkthrough } from './walk.ts';

export const WALKTHROUGHS: Readonly<Record<string, Walkthrough>> = {
  // My Trades for a buyer with no trades: the empty state. The proof of the harness, see docs/ui-review/T-113.
  AC1: {
    screen: 'AC1',
    persona: 'buyer',
    scenario: 'no-trades',
    path: '/trades',
  },
};

/** The walk for a screen, or a message listing the ones that exist. */
export function walkFor(screen: string): Walkthrough {
  const walk = WALKTHROUGHS[screen];
  if (walk !== undefined) return walk;
  throw new Error(
    `No walkthrough for ${screen}. Walks exist for: ${Object.keys(WALKTHROUGHS).join(', ')}. ` +
      'Add one to tools/visual-check/src/walkthroughs.ts, or pass --persona and --scenario with --url.',
  );
}
