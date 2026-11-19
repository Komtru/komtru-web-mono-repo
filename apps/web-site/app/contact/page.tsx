import type { Metadata } from 'next';
import { WhatsAppIcon } from '../../src/art/Icons';
import { Checks, IconTile, InfoBox } from '../../src/chrome/Blocks';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import { ContactForm } from '../../src/contact/ContactForm';
import { CONTACT } from '../../src/site/nav';

export const metadata: Metadata = {
  title: 'Talk to the Komtru team.',
  description: `Choose the fastest way to reach us: ${CONTACT.whatsapp} on WhatsApp, ${CONTACT.supportEmail} for anything that needs detail, or report a scam and we’ll tell you what to send.`,
};

/**
 * The reference's closing band. Its heading and body are its own words; only the first action has
 * changed — it was "Start a trade" into the app, which rule 1 of the port forbids while Komtru is
 * closed. See `src/site/config.ts`.
 */
const CTA: CtaCopy = {
  heading: 'Be first in when Komtru opens',
  body: 'Setting up will take a few minutes, and nothing is charged until you accept an agreement.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'Help', to: '/help' },
  ],
};

/** A speech bubble, for the in-app chat card. Not in `src/art/Icons.tsx`; only this page uses it. */
function ChatIcon(): React.JSX.Element {
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
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" />
      <path d="M9 11.5h6M9 14.5h3.5" />
    </svg>
  );
}

/** An envelope, for the email card. Same reason as `ChatIcon`. */
function MailIcon(): React.JSX.Element {
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
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M4 7.5l8 5.5 8-5.5" />
    </svg>
  );
}

/** The reference's indigo link inside card prose. */
const LINK: React.CSSProperties = { color: 'var(--trust-indigo)', fontWeight: 600 };

/**
 * The contact page.
 *
 * Every number, address and address-shaped thing on it comes from `CONTACT` in `src/site/nav.ts`.
 * The WhatsApp number in particular is also the one the Safety page tells people is the only real
 * one — two copies of it is one chance for the warning and the number to disagree.
 */
export default function Contact(): React.JSX.Element {
  return (
    <>
      {/*
        One column: none of the five existing scenes is about reaching a person, and each carries
        alt text naming what it actually depicts — a motor park, a packed parcel — which on this
        page would describe something that is not happening. Better no picture than a wrong one.
      */}
      <header className="ph cl">
        <div className="w split">
          <div>
            <h1>Talk to the Komtru team.</h1>
            <p className="lede">Choose the fastest way to reach us.</p>
          </div>
        </div>
      </header>

      <section className="band">
        <div className="w" style={{ maxWidth: 1040 }}>
          {/* The reference goes straight from the h1 to the card headings. A level is named here
              so the page still reads as sections to anyone navigating by heading. */}
          <h2 className="sr-only">Ways to reach us</h2>

          <div className="grid g3" style={{ marginTop: 0 }}>
            {/*
              The reference's first card sent people into the in-app chat. There is no app to open
              yet, so the card stays — chat is still how this will work — but it says so instead of
              implying a door that isn't there.
            */}
            <div className="card rv">
              <IconTile tone="indigo">
                <ChatIcon />
              </IconTile>
              <h3>Chat in the app</h3>
              <p>Opens with the app. Chat is tied to your Trade, so we already know the details.</p>
            </div>

            <div className="card rv">
              <IconTile tone="emerald">
                <WhatsAppIcon />
              </IconTile>
              <h3>WhatsApp</h3>
              <p>
                <a href={CONTACT.whatsappHref} target="_blank" rel="noopener" style={LINK}>
                  {CONTACT.whatsapp}
                </a>{' '}
                on WhatsApp. Never trust a different number.
              </p>
            </div>

            <div className="card rv">
              <IconTile tone="indigo">
                <MailIcon />
              </IconTile>
              <h3>Email</h3>
              <p>
                <a href={`mailto:${CONTACT.supportEmail}`} style={LINK}>
                  {CONTACT.supportEmail}
                </a>{' '}
                for anything that needs detail.
              </p>
            </div>
          </div>

          <p className="note" style={{ marginTop: 16 }}>
            Visit us: {CONTACT.address}
          </p>

          <div className="grid g2" style={{ marginTop: 20, alignItems: 'stretch' }}>
            <div className="card">
              <h3>Send us a message</h3>
              <ContactForm />
            </div>

            <div className="card">
              <h3>Report a scam</h3>
              <p>Tell us what happened. We’ll never ask for your PIN or a code.</p>
              <Checks
                items={[
                  { text: 'The Trade Code, if there is one' },
                  { text: 'Screenshots of the messages' },
                  { text: 'Any link or number they used' },
                ]}
              />
              <InfoBox tone="warn" style={{ marginTop: 20 }}>
                If you’ve already paid outside Komtru, contact us anyway. We can help with what comes next,
                but can’t recover that payment.
              </InfoBox>
            </div>
          </div>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
