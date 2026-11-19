import Link from 'next/link';
import { CtaBand, type CtaCopy } from './CtaBand';
import { CONTACT } from '../site/nav';

const CTA: CtaCopy = {
  heading: 'Complete your next trade with komtru',
  body: 'Join the waitlist and be first in when your city opens.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'Back to the home page', to: '/' },
  ],
};

/**
 * A page the site links to but has not written yet.
 *
 * Every route in the header and the footer resolves to something from the first deploy, because a
 * navigation bar where six of seven links 404 reads as a broken site rather than an early one.
 * Each of these is replaced by its real page as that page is written; none of them is a permanent
 * fixture, and none pretends the content exists.
 *
 * It answers 200, not 404: the page is not missing, it is not written. A 404 would take these out
 * of a sitemap and tell a crawler the URL is wrong, and it is not.
 */
export function ComingSoon({
  title,
  summary,
}: {
  title: string;
  /** What the page will say, in one line — so the link that led here was not a lie. */
  summary: string;
}): React.JSX.Element {
  return (
    <>
      <header className="ph band cl" style={{ padding: '56px 0 64px' }}>
        <div className="w" style={{ maxWidth: 720 }}>
          <h1 style={{ fontSize: 'clamp(32px,5vw,50px)' }}>{title}</h1>
          <p className="lede">{summary}</p>
          <p className="note">
            This page is being written and will be here before Komtru opens. In the meantime,{' '}
            <a
              href={CONTACT.whatsappHref}
              target="_blank"
              rel="noopener"
              style={{ color: 'var(--trust-indigo)', fontWeight: 600 }}
            >
              message us on WhatsApp
            </a>{' '}
            or email{' '}
            <a
              href={`mailto:${CONTACT.supportEmail}`}
              style={{ color: 'var(--trust-indigo)', fontWeight: 600 }}
            >
              {CONTACT.supportEmail}
            </a>
            .
          </p>
          <div className="row">
            <Link className="btn bp" href="/waitlist">
              Join the waitlist
            </Link>
            <Link className="btn bs" href="/">
              Back to the home page
            </Link>
          </div>
        </div>
      </header>
      <CtaBand copy={CTA} />
    </>
  );
}
