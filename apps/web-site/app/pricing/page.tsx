import type { Metadata } from 'next';
import { AgreementScene } from '../../src/art/Illustrations';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import { FeeCalculator } from '../../src/pricing/FeeCalculator';

export const metadata: Metadata = {
  title: 'Know exactly what you pay.',
  description:
    'Komtru pricing: move the slider and switch sides to see what a buyer pays, what a seller receives, and when the payment is released.',
};

/*
 * The reference's band offered "Start a trade" and a dialog that asked for a Trade Code. The
 * first sends a visitor into a product that is not open — see `src/site/config.ts` — so it
 * becomes the waitlist, label and all. The code lookup is a page here, not a dialog.
 */
const CTA: CtaCopy = {
  heading: 'Know every fee before you pay, when Komtru opens',
  body: 'See every fee before you pay.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'Enter trade code', to: '/trade-code' },
  ],
};

/**
 * The pricing page.
 *
 * Almost all of it is the calculator, which is a client component. This stays on the server so
 * the heading, the illustration and the closing band are rendered once and shipped as markup.
 */
export default function Pricing(): React.JSX.Element {
  return (
    <>
      <header className="ph cl">
        <div className="w split">
          <div>
            <h1>Know exactly what you pay.</h1>
            <p className="lede">Move the slider and switch sides.</p>
          </div>
          <div className="ill rv">
            <AgreementScene />
          </div>
        </div>
      </header>

      <section className="band es">
        <div className="w split">
          <FeeCalculator />
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
