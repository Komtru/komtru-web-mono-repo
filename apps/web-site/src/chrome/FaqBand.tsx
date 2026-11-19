import Link from 'next/link';
import { FAQ_AVATARS } from '../art/Icons';
import { HOME_FAQ } from '../site/faq';

/**
 * The FAQ band.
 *
 * Built out of `<details>` rather than a disclosure widget of our own: it opens and closes with no
 * JavaScript, it is a button to a screen reader without being told to be one, and the browser's
 * find-in-page can reach the answer inside a closed one. The `+`/`–` is a `::after` on the summary,
 * which is why there is no icon here.
 *
 * The first one is open, as in the reference: an accordion where every row is shut reads as a list
 * of links rather than as an answer to anything.
 */
export function FaqBand(): React.JSX.Element {
  return (
    <div className="band cl" id="faqs">
      <div className="w faqg">
        <div className="faql">
          <h2>Frequently Asked Questions - FAQ</h2>
          <p className="lede" style={{ fontSize: 16 }}>
            Find quick answers to common questions about trades, payments and security.
          </p>
          <div className="faqc">
            <div className="avs">
              {FAQ_AVATARS}
              <span className="plus">+</span>
              <span className="you">You</span>
            </div>
            <h3>Still have questions?</h3>
            <p>Reach out, and our team will guide you.</p>
            <Link className="btn bp" href="/contact">
              Talk to our team →
            </Link>
          </div>
        </div>
        <div className="faqr">
          {HOME_FAQ.map(({ question, answer }, index) => (
            <details key={question} open={index === 0}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
