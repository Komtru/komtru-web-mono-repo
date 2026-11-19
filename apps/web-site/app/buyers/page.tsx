import type { Metadata } from 'next';
import Link from 'next/link';
import { BuyerScene } from '../../src/art/Illustrations';
import { Checks, IconTile, InfoBox, type Tone } from '../../src/chrome/Blocks';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';

export const metadata: Metadata = {
  title: 'Pay without blindly trusting a stranger.',
  description:
    'Your money stays protected until you’ve checked what arrived: the agreement, the protected payment, the inspection window and the five things to check before you pay.',
};

/** The buyer's journey, as the six screens they actually see. */
const STEPS = [
  { n: '01', title: 'Find a seller', body: 'Or enter their Trade Code.' },
  { n: '02', title: 'Review the agreement', body: 'Item, price, delivery, inspection.' },
  { n: '03', title: 'Pay & protect', body: 'Funds are protected under the agreement.' },
  { n: '04', title: 'Track', body: 'Always see the next step.' },
  { n: '05', title: 'Inspect', body: 'Check against the seller’s proof.' },
  { n: '06', title: 'Confirm or report', body: 'Release payment or report a problem.' },
];

/**
 * The six marks above the "What you control" cards.
 *
 * They live here rather than in `src/art/Icons.tsx` because no other page uses them, and that
 * file is shared with eleven pages being written at the same time. Each is the reference's own
 * path, drawn with `currentColor` so `IconTile` gives it the card's tone.
 */
const strokeProps = {
  viewBox: '0 0 24 24',
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** What you control: the six things that stay the buyer's decision, and their reference tones. */
const CONTROLS: readonly { tone: Tone; title: string; body: string; icon: React.JSX.Element }[] = [
  {
    tone: 'indigo',
    title: 'What you agree to',
    body: 'Nothing is charged until you’ve read and accepted the terms. If the seller changes anything, you review it again.',
    icon: (
      <svg {...strokeProps}>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M10 12h5M10 16h5" />
      </svg>
    ),
  },
  {
    tone: 'emerald',
    title: 'When money is released',
    body: 'Only when you confirm the item, or an agreed outcome is reached. It never leaves on its own.',
    icon: (
      <svg {...strokeProps}>
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
      </svg>
    ),
  },
  {
    tone: 'indigo',
    title: 'Where it goes',
    body: 'Your door, or a motor park you choose. You can change your address before it ships.',
    icon: (
      <svg {...strokeProps}>
        <path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11z" />
        <circle cx="12" cy="10" r="2" />
      </svg>
    ),
  },
  {
    tone: 'amber',
    title: 'How long you have',
    body: '48 hours for Electronics and 24 for Fashion & Luxury, and you can ask for more.',
    icon: (
      <svg {...strokeProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    ),
  },
  {
    tone: 'indigo',
    title: 'What happens if it’s wrong',
    body: 'Report it, settle it with the seller, or let a person decide. You can appeal once.',
    icon: (
      <svg {...strokeProps}>
        <circle cx="6" cy="12" r="2" />
        <circle cx="18" cy="12" r="2" />
        <path d="M8 12h8" />
      </svg>
    ),
  },
  {
    tone: 'emerald',
    title: 'Who you’re dealing with',
    body: 'See their verification and their record of completed Trades before you commit.',
    icon: (
      <svg {...strokeProps}>
        <path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />
      </svg>
    ),
  },
];

/** The five things to check before paying. All ticks: each line is a thing that should be true. */
const BEFORE_YOU_PAY = [
  { text: 'The Trade Code matches what the seller told you' },
  { text: 'The item details are filled in by the seller, not you' },
  { text: 'The seller’s photos and video look like their own, not a catalogue' },
  { text: 'The delivery cost and time are on the agreement' },
  { text: 'You’re paying inside Komtru, never to a personal account or from a link' },
];

/*
 * The reference closed with "Protect my first payment" into the app and "Check a Trade Code" into
 * a dialog. The app is not open, so the first becomes the waitlist under its own name; the second
 * is the site's own lookup page, which does the same job without an account.
 */
const CTA: CtaCopy = {
  heading: 'Protect your next purchase when Komtru opens',
  body: 'Pay only when what arrives matches what you agreed.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'Check a Trade Code', to: '/trade-code' },
  ],
};

/** The buyer's side of the trade. */
export default function Buyers(): React.JSX.Element {
  return (
    <>
      <header className="ph cl">
        <div className="w split">
          <div>
            <h1>Pay without blindly trusting a stranger.</h1>
            <p className="lede">Your money stays protected until you’ve checked what arrived.</p>
          </div>
          <div className="ill rv">
            <BuyerScene />
          </div>
        </div>
      </header>

      {/*
        One column, where the reference put the six cards beside the phone-screen player. The
        player is phase 3; with it gone a half-width `.g2` would be two narrow columns of
        three-word cards, so the six run three across instead.
      */}
      <section className="band">
        <div className="w">
          <h2>Six steps, all on screen.</h2>
          <div className="grid g3">
            {STEPS.map(({ n, title, body }) => (
              <div className="card rv" key={n}>
                <span className="n">{n}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/*
        The reference had an "evidence photos compared with the agreed item" scene beside this.
        There is no equivalent in `src/art/Illustrations.tsx` and inventing one means editing a
        shared file, so the band is one column — see the request at the end of the report.
      */}
      <section className="band cl">
        <div className="w">
          <h2>Your payment stays protected while it’s reviewed.</h2>
          <p className="lede" style={{ maxWidth: 680 }}>
            Report a problem with evidence. The seller responds, people decide, and one appeal is available.
          </p>
          <div className="row">
            <Link className="btn bp" href="/safety">
              How disputes work
            </Link>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="w">
          <h2>What you control</h2>
          <div className="grid g3">
            {CONTROLS.map(({ tone, title, body, icon }) => (
              <div className="card rv" key={title}>
                <IconTile tone={tone}>{icon}</IconTile>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band cl">
        <div className="w">
          <div className="split">
            <div>
              <h2>Before you pay, check these five things.</h2>
              <Checks items={BEFORE_YOU_PAY} />
            </div>
            <InfoBox tone="warn">
              <b>If a seller asks you to pay outside Komtru, stop.</b> That’s the one thing that takes your
              protection away. Tell us.
            </InfoBox>
          </div>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
