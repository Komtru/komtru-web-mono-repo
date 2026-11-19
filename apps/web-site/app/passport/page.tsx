import type { Metadata } from 'next';
import { PassportScene } from '../../src/art/Illustrations';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import { BadgeExplainer } from '../../src/passport/BadgeExplainer';

export const metadata: Metadata = {
  title: 'Facts, not a score.',
  description:
    'The Komtru Trust Passport: completed trades, verification and how problems were handled. Shareable on Instagram, WhatsApp and proposals.',
};

/**
 * The figures on the example card.
 *
 * They are the reference's, and they are invented — TechEdge NG is not a seller. The card is
 * labelled "Example profile" above the name for exactly that reason; keep the label with the
 * numbers wherever they move.
 */
const EXAMPLE_STATS = [
  { value: '342', label: 'Trades completed' },
  { value: '98.7%', label: 'Fulfilment' },
  { value: '2.1 days', label: 'Avg. delivery' },
  { value: '4 yrs', label: 'Active' },
];

/*
 * The reference closed with "Start a trade" beside "Join the waitlist". The first goes to the
 * waitlist now (see `src/site/config.ts`), which would have left two buttons to one page — so the
 * outlined one goes to the sellers page instead. That is the page this one is arguing for: a
 * Passport is the record a seller shares in a proposal, and "how do I get one" is the question
 * someone finishes this page holding.
 *
 * The heading is reworded for the same reason the home band's is. The reference said "Complete
 * your next trade and build your record" above a button that now says "Join the waitlist"; there
 * is no next trade to complete yet, and the two together would read as a bait.
 */
const CTA: CtaCopy = {
  heading: 'Start building your record when Komtru opens',
  body: 'Every completed Trade adds to a record people can see and trust.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'For sellers', to: '/sellers' },
  ],
};

/** The Trust Passport page. */
export default function Passport(): React.JSX.Element {
  return (
    <>
      <header className="ph band cl">
        <div className="w split">
          <div>
            <h1>Facts, not a score.</h1>
            <p className="lede">
              Completed trades, verification and how problems were handled. Shareable on Instagram, WhatsApp
              and proposals.
            </p>
          </div>
          <div className="ill rv">
            <PassportScene />
          </div>
        </div>
      </header>

      <section className="band dk">
        <div className="w split">
          <div>
            <h2>Tap a badge to see what it means.</h2>
            <BadgeExplainer />
          </div>
          <div className="pp">
            <small style={{ fontSize: 11, letterSpacing: '.08em' }}>Trust Passport · Example profile</small>
            <h3 style={{ fontSize: 26, marginTop: 6 }}>TechEdge NG</h3>
            <div className="s">
              {EXAMPLE_STATS.map(({ value, label }) => (
                <div key={label}>
                  <b>{value}</b>
                  <small>{label}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/*
        One column, not a split: the reference put the phone-screen player beside this copy and
        the player is phase 3. A two-column band with one empty half reads as a layout bug.

        Its lede was "Tap through trust history, verification and reviews" — an instruction to
        tap the player. With nothing to tap it becomes a dead end, so it states what the three
        sections are instead. The heading is the reference's.
      */}
      <section className="band">
        <div className="w">
          <h2>Your Passport grows after every trade.</h2>
          <p className="lede">Trust history, verification and reviews, in one place.</p>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
