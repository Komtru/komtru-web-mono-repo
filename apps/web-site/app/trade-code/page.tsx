import type { Metadata } from 'next';
import { TradeCodeBackdrop } from '../../src/art/Illustrations';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import { TradeCodeLookup } from '../../src/home/TradeCodeLookup';
import { ShareCode } from './ShareCode';

export const metadata: Metadata = {
  title: 'Got a code? Check it yourself.',
  description:
    'Check a Komtru Trade Code. Search the code yourself rather than tapping a payment link from a stranger.',
};

/** What the lookup shows, in the order it shows it. */
const WHAT_YOU_SEE: readonly { number: string; title: string; body: string }[] = [
  { number: '01', title: 'Seller identity', body: 'Verification status first.' },
  { number: '02', title: 'The agreed terms', body: 'Item, price, delivery, inspection.' },
  { number: '03', title: 'Trade status', body: 'Where the trade is right now.' },
];

// The reference's first button was "Start a trade" into the app. Komtru is not open, so it says
// the thing someone can actually do — see the note in `src/site/config.ts`.
const CTA: CtaCopy = {
  heading: 'Found your trade? Finish it when Komtru opens',
  body: 'Check the code, review the agreement, protect the payment.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'How it works', to: '/how-it-works' },
  ],
};

/**
 * The Trade Code page.
 *
 * One sentence is the reason it exists: open Komtru on your own and search the Trade, no payment
 * links from strangers. Everything else on the page is in service of that habit — the lookup
 * proves how little effort it takes, the share box shows the seller's half of it, and the three
 * cards say what the search is worth.
 *
 * The lookup itself is `src/home/TradeCodeLookup.tsx`, the same component and the same example
 * trade as the home page's band. A visitor who tried the code there and again here must get the
 * same answer, which a second implementation could not promise.
 */
export default function TradeCode(): React.JSX.Element {
  return (
    <>
      <header className="ph band tcb">
        <div className="w split">
          <div>
            <h1>Got a code? Check it yourself.</h1>
            <p className="lede">
              Open Komtru on your own and search the Trade. No payment links from strangers.
            </p>
            <TradeCodeLookup />
          </div>
          <div className="tcc rv">
            <TradeCodeBackdrop />
            <div className="tcq">
              {/* The reference's `h3`, raised to `h2` so the page's headings stay in order under
                  its `h1`; `.tcq h3` held the size, so the size comes inline. */}
              <h2 style={{ fontSize: 'clamp(20px,2.4vw,26px)' }}>“Send me the Komtru Trade Code.”</h2>
              <p>The new way to ask a seller.</p>
            </div>
          </div>
        </div>
      </header>

      <section className="band">
        <div className="w split">
          <div>
            <h2>Send your Trade Code the safe way.</h2>
            <p className="lede">
              Send the code, not a link. Your buyer opens Komtru themselves and searches it.
            </p>
          </div>
          <ShareCode />
        </div>
      </section>

      {/*
        One column, and `g3` rather than the reference's `g2`: the app-screen player that filled
        the other half of this split is phase 3 and deliberately absent, and three cards across a
        full-width band read as a row instead of two-and-a-gap.
      */}
      <section className="band is">
        <div className="w">
          <h2>What you’ll see.</h2>
          <div className="grid g3">
            {WHAT_YOU_SEE.map(({ number, title, body }) => (
              <div className="card rv" key={number}>
                <span className="n">{number}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
