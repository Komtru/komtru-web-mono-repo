import Image from 'next/image';
import Link from 'next/link';
import {
  AgreementScene,
  BuyerScene,
  HubScene,
  PassportScene,
  SellerScene,
  TradeCodeBackdrop,
} from '../src/art/Illustrations';
import { CtaBand, HOME_CTA } from '../src/chrome/CtaBand';
import { FaqBand } from '../src/chrome/FaqBand';
import { AppQrCard } from '../src/home/AppQrCard';
import { Hero } from '../src/home/Hero';
import { TradeCodeLookup } from '../src/home/TradeCodeLookup';
import { WaitlistForm } from '../src/home/WaitlistForm';
import { LAUNCH_CITIES } from '../src/site/nav';

/** The three audiences, and where each is sent. */
const SIDES = [
  { href: '/buyers', title: 'Buyers', line: 'Pay without sending money into the unknown.', Art: BuyerScene },
  { href: '/sellers', title: 'Sellers', line: 'Know the buyer has paid before you ship.', Art: SellerScene },
  {
    href: '/hubs',
    title: 'Park Hubs',
    line: 'Collect or hand over at a motor park near you.',
    Art: HubScene,
  },
];

/**
 * The partner marks.
 *
 * Names, not logos, until each partner has given permission — which is what the line beneath the
 * row says. An empty string is a mark we do not have the right to show yet; the name stands in its
 * place rather than the row shrinking, because the row is the claim.
 */
const PARTNERS = ['Fex Logistics', 'GIGM', 'ABC Logistics', 'Wema Bank', 'Paystack'];

/** The site's front door. */
export default function Home(): React.JSX.Element {
  return (
    <>
      <Hero />

      <section className="band cl">
        <div className="w split">
          <div className="ill rv">
            <AgreementScene />
          </div>
          <div>
            <h2>Both sides know the deal before money moves.</h2>
            <p className="lede">
              Item, price, delivery and inspection are agreed first. The payment is protected. Evidence
              settles problems.
            </p>
            <div className="row">
              <Link className="btn bp" href="/buyers">
                For buyers
              </Link>
              <Link className="btn bs" href="/sellers">
                For sellers
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/*
        White, where the reference had `cl`. The reference alternated grey and white down the page
        and this band was grey because the white one above it was the screen-by-screen walkthrough.
        That band is not here yet, so keeping this grey would put two grey bands back to back and
        read as one long block.
      */}
      <section className="band">
        <div className="w">
          <h2>Whichever side you’re on.</h2>
          <div className="grid g3">
            {SIDES.map(({ href, title, line, Art }) => (
              <Link key={href} className="card lc rv" href={href}>
                <div className="im">
                  <Art />
                </div>
                <div className="tx">
                  <h3>{title}</h3>
                  <p>{line}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="band tcb">
        <div className="w split">
          <div>
            <h2>Got a code? Check it yourself.</h2>
            <p className="lede">
              Open Komtru on your own and search the Trade. No payment links from strangers.
            </p>
            <TradeCodeLookup />
          </div>
          <div className="tcc rv">
            <TradeCodeBackdrop />
            <div className="tcq">
              <h3>“Send me the Komtru Trade Code.”</h3>
              <p>The new way to ask a seller.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="w">
          <h2>Coming to a city near you</h2>
          <p className="lede" style={{ maxWidth: 760 }}>
            We’re starting where trust matters most: higher-value goods, bought from people you’ve only met
            online — from any city, delivered to your doorstep anywhere in Nigeria. Starting this December.
          </p>
          <div className="cs" tabIndex={0} aria-label="Launch cities, scroll to see all">
            {LAUNCH_CITIES.map(({ slug, name }, index) => (
              <div className="po" key={slug}>
                <Image
                  src={`/cities/${slug}.jpg`}
                  alt={`Komtru launch city: ${name}`}
                  width={900}
                  height={1273}
                  sizes="(min-width: 1100px) 25vw, (min-width: 600px) 40vw, 66vw"
                  // The first card is above the fold on a wide screen; the rest are scrolled to.
                  loading={index === 0 ? 'eager' : 'lazy'}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band dk">
        <div className="w split r">
          <div>
            <h2>Facts, not a score.</h2>
            <p className="lede">
              Completed trades, verification and how problems were handled, shareable anywhere.
            </p>
            <div className="row">
              <Link className="btn bw" href="/passport">
                See a Trust Passport
              </Link>
            </div>
          </div>
          <div className="ill rv">
            <PassportScene />
          </div>
        </div>
      </section>

      <section className="band">
        <div className="w">
          <h2 style={{ fontSize: 'clamp(24px,3.4vw,34px)', maxWidth: 640 }}>
            Built with the companies that move Nigeria’s goods and money.
          </h2>
          <div className="pl">
            {PARTNERS.map((name) => (
              <div className="lg" key={name} role="img" aria-label={name}>
                {name}
              </div>
            ))}
          </div>
          <p className="note">Partner marks are shown only with each partner’s permission.</p>
        </div>
      </section>

      <section className="band es" id="waitlist">
        <div className="w split">
          <div>
            <h2>Join the waitlist. Get the app first.</h2>
            <p className="lede">
              Komtru isn’t open yet. Add your name and we’ll tell you when your city goes live.
            </p>
            <div style={{ marginTop: 24 }}>
              <AppQrCard />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <WaitlistForm />
          </div>
        </div>
      </section>

      <FaqBand />
      <CtaBand copy={HOME_CTA} />
    </>
  );
}
