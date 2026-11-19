import type { Metadata } from 'next';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import { AppQrCard } from '../../src/home/AppQrCard';
import { WaitlistForm } from '../../src/home/WaitlistForm';

export const metadata: Metadata = {
  title: 'Join the waitlist',
  description:
    'Join the Komtru waitlist and download the app on iOS and Android the day it launches in Lagos, Abuja, Port Harcourt and Jos.',
};

const CTA: CtaCopy = {
  heading: 'Complete your next trade with komtru',
  body: 'Join the waitlist and be first in when your city opens.',
  actions: [
    { label: 'Start a trade', to: { app: '/signup' } },
    { label: 'How it works', to: { site: '/how-it-works' } },
  ],
};

/**
 * The waitlist page.
 *
 * It exists in phase one because two things already point at it: the QR code in the home page's
 * signup band, and every call to action on the site while `NEXT_PUBLIC_KOMTRU_APP_URL` is unset.
 * Both would otherwise land on a 404.
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

      <section className="band es">
        <div className="w split">
          <div>
            <AppQrCard />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <WaitlistForm />
          </div>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
