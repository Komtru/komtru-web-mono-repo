import type { Metadata } from 'next';
import Link from 'next/link';
import { SellerScene } from '../../src/art/Illustrations';
import { Checks, IconTile, Steps } from '../../src/chrome/Blocks';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';

export const metadata: Metadata = {
  title: 'Get paid for honest trades.',
  description:
    'Open a shop on Komtru: verify once, accept a request with proof, ship only after the buyer’s payment is protected, and build a record that follows you.',
};

/*
 * The three marks for "What changes for you".
 *
 * `src/art/Icons.tsx` is the brand and social set; it carries no general-purpose glyphs, and that
 * file is shared with eleven other pages being written right now. These are the reference's own
 * paths, small enough to sit beside the copy they label. They inherit `currentColor` from the
 * tile, so the tone comes from `IconTile` and never from a colour written here.
 */
function TargetMark(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
    </svg>
  );
}

function ParcelMark(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8l9-4 9 4-9 4zM3 8v8l9 4 9-4V8" />
    </svg>
  );
}

function CarryMark(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />
    </svg>
  );
}

/** The four numbered cards: what a sale looks like end to end. */
const SALE_STAGES = [
  { n: '01', title: 'Verify your business', body: 'Once, reused every trade.' },
  { n: '02', title: 'Accept a request', body: 'With proof the buyer can compare.' },
  { n: '03', title: 'Dispatch with a waybill', body: 'Ship once funds are protected.' },
  { n: '04', title: 'Get paid', body: 'Released after the buyer confirms.' },
];

/** What is different about selling here, one card each. */
const CHANGES = [
  {
    tone: 'emerald',
    Mark: TargetMark,
    title: 'The money is there before you ship',
    body: 'You’re told to dispatch only once the buyer’s payment is protected. You ship knowing it’s real.',
  },
  {
    tone: 'amber',
    Mark: ParcelMark,
    title: 'No more ghost buyers',
    body: 'No paying a courier to carry a parcel nobody collects, and no item coming back damaged and unpaid for.',
  },
  {
    tone: 'indigo',
    Mark: CarryMark,
    title: 'A record that follows you',
    body: 'Your completed Trades become a Trust Passport you can share in your bio, your chats, or a loan application.',
  },
] as const;

const OPENING_STEPS = [
  {
    title: 'Get verified',
    body: 'Your identity once, and your business if you have one. We check with licensed providers.',
  },
  {
    title: 'Show your items',
    body: 'At least three photos and a video, taken on your own camera. Clear proof builds trust fast and prevents disputes.',
  },
  {
    title: 'Set your delivery',
    body: 'Choose your couriers, your park delivery charge, and how long you usually take.',
  },
  {
    title: 'Share a Trade Code',
    body: 'Send buyers a code, not a payment link. They search it in Komtru and see everything.',
  },
];

const EXPECTED = [
  { text: 'Photos and video you took yourself' },
  { text: 'Item details that are accurate' },
  { text: 'Shipping within the time you promised' },
  { text: 'Replies when buyers ask' },
];

const NOT_ACCEPTED = [
  { text: 'Stock, downloaded or AI-generated images', bad: true },
  { text: 'Asking buyers to pay outside Komtru', bad: true },
  { text: 'Changing the item after it’s agreed', bad: true },
  { text: 'Delivery costs added later', bad: true },
];

/** The shop tools, in the reference's order. */
const TOOLS = [
  {
    title: 'Import your stock list',
    body: 'Bring a spreadsheet across as drafts. Each item still needs its proof before it goes live.',
  },
  {
    title: 'Customers you’ve traded with',
    body: 'See repeat buyers, add private notes, and start a new Trade in a tap.',
  },
  {
    title: 'Waybills and labels',
    body: 'Print labels for the orders that are ready to ship. They never carry a PIN.',
  },
  { title: 'Your team', body: 'Give staff only the access their job needs. Only you can move money.' },
  {
    title: 'Badges you earn',
    body: 'Verified, on-time and fast-reply badges that come from your real record, never from a payment.',
  },
  {
    title: 'Fee invoices',
    body: 'Invoices for Komtru’s fees and your tax details, ready for your accountant.',
  },
];

/*
 * The reference closed with "Open my shop" beside "Join the seller waitlist". There is no shop to
 * open while Komtru is closed, so the first button is the waitlist. That leaves the second with
 * nowhere distinct to go — two buttons to `/waitlist` is one button drawn twice — so it goes to
 * pricing. A seller who has read this far has one question left that the page has not answered:
 * what Komtru takes out of the sale. `/how-it-works` is the buyer-shaped follow-on and the home
 * band already offers it.
 */
const SELLERS_CTA: CtaCopy = {
  heading: 'Get paid for the sales you honour, when Komtru opens',
  body: 'Get paid for the Trades you honour, with the buyer’s payment protected before you ship.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'See what it costs', to: '/pricing' },
  ],
};

export default function Page(): React.JSX.Element {
  return (
    <>
      <header className="ph cl">
        <div className="w split">
          <div>
            <h1>Get paid for honest trades.</h1>
            <p className="lede">
              Your customers want to buy. They just don’t know if they can trust you yet.
            </p>
          </div>
          <div className="ill rv">
            <SellerScene />
          </div>
        </div>
      </header>

      {/*
        One column, where the reference had the words beside a phone running the seller flows
        (open your shop, run orders, create a trade). The screen player is phase 3; a half-width
        column with a gap beside it reads as a layout that failed to load.
      */}
      <section className="band">
        <div className="w">
          <h2>Open a shop. Accept. Ship. Get paid.</h2>
          <div className="grid g2">
            {SALE_STAGES.map(({ n, title, body }) => (
              <div className="card rv" key={n}>
                <span className="n">{n}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="w">
          <h2>What changes for you</h2>
          <div className="grid g3">
            {CHANGES.map(({ tone, Mark, title, body }) => (
              <div className="card rv" key={title}>
                <IconTile tone={tone}>
                  <Mark />
                </IconTile>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band cl">
        <div className="w">
          <h2>Open a shop in four steps.</h2>
          <Steps steps={OPENING_STEPS} />
        </div>
      </section>

      <section className="band">
        <div className="w">
          <div className="split">
            <div>
              <h2>Be exactly who your photos say you are.</h2>
              <p className="lede">
                Buyers rely on your proof. When it’s honest, disputes are rare and decided quickly, and your
                record shows it.
              </p>
            </div>
            <div className="grid g2" style={{ marginTop: 0 }}>
              <div className="card">
                <h3>We expect</h3>
                <Checks items={EXPECTED} />
              </div>
              <div className="card">
                <h3>We don’t accept</h3>
                <Checks items={NOT_ACCEPTED} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band cl">
        <div className="w">
          <h2>Tools that grow with your shop.</h2>
          <div className="grid g3">
            {TOOLS.map(({ title, body }) => (
              <div className="card rv" key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band es">
        <div className="w">
          <h2>No ghost buyers. No wasted delivery fees.</h2>
          <p className="lede">A dispute is a chance to respond with evidence, not an accusation.</p>
          <div className="row">
            <Link className="btn bp" href="/waitlist">
              Join the waitlist
            </Link>
          </div>
        </div>
      </section>

      <CtaBand copy={SELLERS_CTA} />
    </>
  );
}
