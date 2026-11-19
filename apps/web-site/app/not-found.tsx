import Link from 'next/link';

export const metadata = { title: 'Page not found' };

/** 404, in the site's own voice: short, and pointing at the two things that always exist. */
export default function NotFound(): React.JSX.Element {
  return (
    <section className="band">
      <div className="w" style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 'clamp(32px,5vw,50px)' }}>That page isn’t here.</h1>
        <p className="lede">
          It may have moved, or the link may be wrong. Komtru never asks you to pay from a link — if you
          arrived from one, don’t tap it again.
        </p>
        <div className="row">
          <Link className="btn bp" href="/">
            Back to the home page
          </Link>
          <Link className="btn bs" href="/waitlist">
            Join the waitlist
          </Link>
        </div>
      </div>
    </section>
  );
}
