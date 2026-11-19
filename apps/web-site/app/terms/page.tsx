import type { Metadata } from 'next';
import Link from 'next/link';
import { AgreementScene } from '../../src/art/Illustrations';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';

/**
 * `noindex`, and only until the real text lands.
 *
 * This URL is the permanent home of the terms and the privacy policy, so it stays in the nav and
 * answers 200 — but there is nothing on it yet. Indexed as it stands, a search for "Komtru terms"
 * returns a page that states no terms, and that result is worse than no result: it reads as a
 * marketplace holding other people's money with its legal position left blank. `follow` stays on,
 * so the contact link and the footer are still crawled.
 *
 * DELETE THIS `robots` BLOCK when the owner supplies the terms and the privacy policy. A noindex
 * left behind on the published terms is the opposite mistake and just as quiet.
 */
export const metadata: Metadata = {
  title: 'Terms and privacy policy',
  description: 'Komtru’s full terms and privacy policy will be published here before Komtru opens.',
  robots: { index: false, follow: true },
};

// The reference's "Start a trade" button, as rule 1 in the brief requires: the label changes with
// the destination, because a button that says "Start a trade" and lands on a waitlist form is the
// promise `src/site/config.ts` forbids.
const CTA: CtaCopy = {
  heading: 'Be first in when Komtru opens',
  body: 'Setting up will take a few minutes, and nothing is charged until you accept an agreement.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'How it works', to: '/how-it-works' },
  ],
};

/**
 * Terms and privacy policy — a holding page, on purpose.
 *
 * The reference page carries no terms and no policy, and this port does not invent any. Legal
 * text for an escrow service is the owner's to supply; drafted or adapted clauses would be both
 * unenforceable and, on a site that asks people to trust it with a payment, dishonest. The page
 * says when the text arrives, repeats the one warning someone needs before it does, and points at
 * a human.
 */
export default function Terms(): React.JSX.Element {
  return (
    <>
      <header className="ph cl">
        <div className="w split">
          <div>
            <h1>Terms and privacy policy.</h1>
            <p className="lede">
              Our full terms and privacy policy will be published here before Komtru opens.
            </p>
          </div>
          <div className="ill rv">
            <AgreementScene />
          </div>
        </div>
      </header>

      <section className="band">
        <div className="w" style={{ maxWidth: 760 }}>
          <p className="lede" style={{ marginTop: 0 }}>
            Komtru never asks you to pay from a link. Questions in the meantime?{' '}
            <Link href="/contact" style={{ color: 'var(--trust-indigo)', fontWeight: 600 }}>
              Contact us
            </Link>
            .
          </p>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
