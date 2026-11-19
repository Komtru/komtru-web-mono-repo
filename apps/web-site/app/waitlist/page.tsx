import type { Metadata } from 'next';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import { WaitlistForm } from '../../src/home/WaitlistForm';

export const metadata: Metadata = {
  title: 'Join the waitlist',
  description:
    'Join the Komtru waitlist and download the app on iOS and Android the day it launches in Lagos, Abuja, Port Harcourt and Jos.',
};

// No "Start a trade" here either; on the waitlist page itself the form above is the action, so
// the band points at the two things someone might want to read instead.
const CTA: CtaCopy = {
  heading: 'What you’re joining',
  body: 'Komtru protects the payment until the item you agreed is delivered, on both sides of the trade.',
  actions: [
    { label: 'How it works', to: '/how-it-works' },
    { label: 'Safety', to: '/safety' },
  ],
};

/**
 * The waitlist page.
 *
 * This is where the whole site points. The app is not open, so every call to action in the
 * header, the hero and every closing band leads here rather than into the product — see the note
 * in `src/site/config.ts`.
 */
export default function Waitlist(): React.JSX.Element {
  return (
    <>
      <header className="ph band cl" style={{ padding: '56px 0 64px' }}>
        <div className="w split" style={{ gap: 36 }}>
          <div>
            <h1 style={{ fontSize: 'clamp(32px,5vw,50px)' }}>Be first in when Komtru opens.</h1>
            <p className="lede">
              Join the waitlist and download the app on iOS and Android the day it launches.
            </p>
          </div>
        </div>
      </header>

      {/* One column: with the QR card gone the form is the whole point of the page. */}
      <section className="band es">
        <div className="w" style={{ display: 'flex', justifyContent: 'center' }}>
          <WaitlistForm />
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
