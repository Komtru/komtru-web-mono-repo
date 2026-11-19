// The walks a ticket can name. Add a row when a screen needs a state the URL alone does not reach. Each
// entry is checked by a test (`test/walkthroughs.test.ts`) against the screen index, so a typo in a screen
// id fails there, not as a wrong screenshot.
import { TRADE_IDS } from './standin/fixtures.ts';
import type { Walkthrough } from './walk.ts';

export const WALKTHROUGHS: Readonly<Record<string, Walkthrough>> = {
  // My Trades for a buyer with no trades: the empty state. The proof of the harness, see docs/ui-review/T-113.
  AC1: {
    screen: 'AC1',
    persona: 'buyer',
    scenario: 'no-trades',
    path: '/trades',
  },
  // The trade workspace for a funded-but-unpaid trade, and its payment-method step (T-116, T-117, T-194).
  'CWT-01': {
    screen: 'CWT-01',
    persona: 'buyer',
    scenario: 'with-trades',
    path: `/trade/${TRADE_IDS.buyerPending}`,
  },
  'CWT-S03': {
    screen: 'CWT-S03',
    persona: 'buyer',
    scenario: 'with-trades',
    path: `/trade/${TRADE_IDS.buyerPending}/fund`,
  },
  // The disputed trade's workspace, its case status and its evidence comparison (T-116, T-120).
  'CWT-05': {
    screen: 'CWT-05',
    persona: 'buyer',
    scenario: 'with-trades',
    path: `/trade/${TRADE_IDS.buyerDisputed}`,
  },
  'CWT-S15': {
    screen: 'CWT-S15',
    persona: 'buyer',
    scenario: 'with-trades',
    path: `/trade/${TRADE_IDS.buyerDisputed}/dispute/status`,
  },
  Y1: {
    screen: 'Y1',
    persona: 'buyer',
    scenario: 'with-trades',
    path: `/trade/${TRADE_IDS.buyerDisputed}/dispute/evidence`,
  },
  // The seller's business verification: the application in review, and the one a decision rejected (T-121).
  M2: {
    screen: 'M2',
    persona: 'seller',
    scenario: 'application-in-review',
    path: '/account/verification/merchant',
  },
  BVR1: {
    screen: 'BVR1',
    persona: 'seller',
    scenario: 'application-rejected',
    path: '/account/verification/merchant',
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
