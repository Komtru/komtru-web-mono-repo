import type { Metadata } from 'next';
import Link from 'next/link';
import { AgreementScene } from '../../src/art/Illustrations';
import { Checks, InfoBox, Steps, type CheckItem, type Step } from '../../src/chrome/Blocks';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'A protected trade step by step: how long you have to check what arrived, how a problem is settled, and whether your item comes to your door or a motor park near you.',
};

/**
 * How long a buyer has to check what arrived, by category.
 *
 * Komtru sets these, not the seller — which is the point the band's lede makes — so they are a
 * policy table rather than copy, and the numbers are the reference's exactly. Changing one here
 * changes a promise, so it is not a thing to tidy.
 */
const INSPECTION: readonly { category: string; examples: string; checkTime: string; extension: string }[] = [
  {
    category: 'Electronics',
    examples: 'Phones, laptops and gadgets.',
    checkTime: '48 hours',
    extension: 'Ask for up to 72 hours',
  },
  {
    category: 'Fashion & Luxury',
    examples: 'Clothing, bags, shoes and more.',
    checkTime: '24 hours',
    extension: 'Ask for up to 48 hours',
  },
];

/** The dispute path, in the order it actually runs. */
const DISPUTE_STEPS: readonly Step[] = [
  { title: 'Report it', body: 'Tell us what’s wrong, with photos. Your payment stays protected.' },
  {
    title: 'Settle directly',
    body: 'You have 48 hours to agree something with the seller. One offer and one counter each.',
  },
  {
    title: 'A person decides',
    body: 'If you can’t agree, a trained person decides using the evidence, and explains why.',
  },
  {
    title: 'It’s carried out',
    body: 'A return and refund, a replacement, a partial settlement, or the payment goes to the seller.',
  },
  {
    title: 'One appeal',
    body: 'If you disagree, someone who wasn’t part of the first decision takes a second look.',
  },
];

const DELIVERY: readonly CheckItem[] = [
  {
    text: (
      <>
        <b>Courier:</b> delivered to your address. The cost is shown before you accept.
      </>
    ),
  },
  {
    text: (
      <>
        <b>Motor park:</b> collect from a hub with your own pickup PIN. Nobody else can release it.
      </>
    ),
  },
  {
    text: 'Returns are handled the same way: hand it in sealed, and it’s tracked until the seller checks it.',
  },
];

/*
 * The reference's closing band put "Start your first trade" into the app. The app is not open, so
 * that button is the waitlist and says so — see the note in `src/site/config.ts`. Pricing is a
 * page on this site, so it is untouched.
 */
const CTA: CtaCopy = {
  heading: 'Make your first protected trade when Komtru opens',
  body: 'Setting up will take a few minutes, and nothing is charged until you accept an agreement.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'See pricing', to: '/pricing' },
  ],
};

/**
 * How it works.
 *
 * The reference opened this page with a "Follow a trade, screen by screen" band: an empty
 * `.steps` list and a `.pw` phone player that JavaScript filled with app-screen mockups. The
 * player is phase 3 and deliberately absent, and with it gone that band was a heading over
 * nothing, so the whole band is out rather than left as a hole. A second `.pw` player sat beside
 * the delivery copy further down and went for the same reason; that band is a single column now.
 *
 * Dropping the first band also took a white band out from between two grey ones, so every band
 * below it is flipped to keep the page alternating. The reference's last two bands were both grey
 * and that doubling is what absorbs the shift — the closing band's class is unchanged.
 */
export default function HowItWorks(): React.JSX.Element {
  return (
    <>
      <header className="ph band cl">
        <div className="w split">
          <div>
            <h1>A trade, from agreement to payout.</h1>
            {/* The reference's lede ended "…exactly as it appears in the Komtru app", which was a
                promise the dropped screen player kept. Nothing on the page shows an app screen
                now, so the clause goes rather than stands as a claim the page cannot meet. */}
            <p className="lede">Follow a protected trade step by step.</p>
          </div>
          <div className="ill rv">
            <AgreementScene />
          </div>
        </div>
      </header>

      <section className="band">
        <div className="w">
          <h2>An inspection time that depends on what you bought.</h2>
          <p className="lede">
            Inspection times are set by Komtru for each category. They’re the same for every seller, so
            protection means the same thing on every Trade.
          </p>
          <div className="grid g2">
            {INSPECTION.map(({ category, examples, checkTime, extension }) => (
              <div className="card" key={category}>
                <h3>{category}</h3>
                <p>{examples}</p>
                <div className="tr2">
                  <span>Time to check</span>
                  <b>{checkTime}</b>
                </div>
                <div className="tr2">
                  <span>Need longer?</span>
                  <b>{extension}</b>
                </div>
              </div>
            ))}
          </div>
          <InfoBox style={{ marginTop: 20 }}>
            <b>When does the clock start?</b> For delivery to your door, as soon as it’s delivered. For a
            motor park, 12 hours after it arrives, so you have time to collect it first.
          </InfoBox>
        </div>
      </section>

      <section className="band cl">
        <div className="w">
          <h2>Settle it first. If not, a person decides.</h2>
          <Steps steps={DISPUTE_STEPS} />
          <p className="lede" style={{ maxWidth: 640, marginTop: 28, fontSize: 16 }}>
            A dispute doesn’t mean someone is dishonest. What matters is how it was handled, so a seller who
            cooperates and puts it right isn’t treated like one who doesn’t.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="w" style={{ maxWidth: 720 }}>
          <h2>Your door, or a motor park near you.</h2>
          <p className="lede">
            Choose what suits you. Parks are Komtru-supported hubs where your item is held, sealed, until you
            arrive.
          </p>
          <Checks items={DELIVERY} />
        </div>
      </section>

      <section className="band cl">
        <div className="w">
          <h2>Something went wrong?</h2>
          <p className="lede">
            Your payment stays protected while a problem is reviewed. See how disputes work.
          </p>
          <div className="row">
            <Link className="btn bp" href="/safety">
              Safety &amp; disputes
            </Link>
            <Link className="btn bs" href="/pricing">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
