import type { Metadata } from 'next';
import Link from 'next/link';
import { PassportScene } from '../../src/art/Illustrations';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Komtru is trust infrastructure for social commerce. Every trade creates a record. Every meaningful action creates evidence.',
};

/** What we believe. The numerals are the principles' own, not a count — they are not 1, 2, 3. */
const BELIEFS = [
  { n: 'I', title: 'Trust must be earned', line: 'Never claimed, bought or self-assigned.' },
  { n: 'II', title: 'Evidence over opinion', line: 'Facts and outcomes, not popularity.' },
  { n: 'VIII', title: 'Protect both sides', line: 'We protect agreements, not individuals.' },
] as const;

/** The business, in six lines. */
const BUSINESS = [
  { n: '01', title: 'Opportunity', line: 'Nigeria’s social commerce and its trust gap.' },
  {
    n: '02',
    title: 'Infrastructure',
    line: 'Agreement, protection, verification, fulfilment, disputes.',
  },
  {
    n: '03',
    title: 'Business model',
    line: 'Transaction fees, merchant services, partner economics.',
  },
  { n: '04', title: 'Network', line: 'Buyers, sellers, couriers, hubs, financial partners.' },
  { n: '05', title: 'Defensibility', line: 'Trade history, Trust Passports and operations.' },
  {
    n: '06',
    title: 'Partnerships',
    line: 'Banks, identity providers, logistics, merchant networks.',
  },
] as const;

/*
 * The reference closed this page with "Start a trade", which the app being shut makes a promise
 * we cannot keep — see `src/site/config.ts`. The waitlist takes its place; "Contact us" is the
 * reference's own second action and stands.
 */
const CTA: CtaCopy = {
  heading: 'Be part of it when Komtru opens',
  body: 'Trust infrastructure for people who buy and sell online.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'Contact us', to: '/contact' },
  ],
};

/** The About page — what Komtru is for, and the principles the product is built on. */
export default function About(): React.JSX.Element {
  return (
    <>
      <header className="ph band cl">
        <div className="w split">
          <div>
            <h1>Komtru is trust infrastructure for social commerce.</h1>
            <p className="lede">Every trade creates a record. Every meaningful action creates evidence.</p>
          </div>
          {/* The Trust Passport is what "a record" looks like, so it carries the header. */}
          <div className="ill rv">
            <PassportScene />
          </div>
        </div>
      </header>

      <section className="band">
        <div className="w">
          <h2>What we believe</h2>
          <div className="grid g3">
            {BELIEFS.map(({ n, title, line }) => (
              <div className="card rv" key={n}>
                <span className="n">{n}</span>
                <h3>{title}</h3>
                <p>{line}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band is">
        <div className="w">
          <h2>The business, in six lines.</h2>
          <div className="grid g3">
            {BUSINESS.map(({ n, title, line }) => (
              <div className="card rv" key={n}>
                <span className="n">{n}</span>
                <h3>{title}</h3>
                <p>{line}</p>
              </div>
            ))}
          </div>
          <p className="note">What is operational today and what is planned will be labelled separately.</p>
          <div className="row">
            <Link className="btn bp" href="/contact">
              Talk to us
            </Link>
          </div>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
