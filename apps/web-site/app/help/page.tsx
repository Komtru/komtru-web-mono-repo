import type { Metadata } from 'next';
import Link from 'next/link';
import { AgreementScene } from '../../src/art/Illustrations';
import { InfoBox } from '../../src/chrome/Blocks';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import { HELP_TOPICS } from './questions';

export const metadata: Metadata = {
  title: 'Questions, answered.',
  description:
    'Quick answers to the questions we hear most about Komtru trades, payments, delivery and disputes.',
};

/*
 * The reference's band read "Our team can help, and you can start a trade whenever you're ready"
 * over a "Start a trade" button into the app. Komtru is not open, so neither half is true — see
 * `src/site/config.ts`. Changing only the button would leave the sentence above it promising the
 * thing the button no longer does, which is the same broken promise one line higher up.
 */
const CTA: CtaCopy = {
  heading: 'Still have a question?',
  body: 'Our team can help, and you can join the waitlist whenever you’re ready.',
  actions: [
    { label: 'Contact us', to: '/contact' },
    { label: 'Join the waitlist', to: '/waitlist' },
  ],
};

/**
 * The Help page.
 *
 * Fourteen questions as native `<details>`, the way `FaqBand` does it: they open with no
 * JavaScript, a screen reader announces each summary as a disclosure without being told to, and
 * find-in-page reaches the answer inside a closed one. Nothing here is a client component.
 *
 * Deliberately not `FaqBand`'s `.faqr` wrapper, though: that paints each row as a white card for
 * the grey band it sits in on the home page, and this band is white, as the reference has it. The
 * bare `details` rules in `app/site.css` give the hairline-separated list the reference drew.
 */
export default function Help(): React.JSX.Element {
  return (
    <>
      <header className="ph cl">
        <div className="w split">
          <div>
            <h1>Questions, answered.</h1>
            <p className="lede">Quick answers to the questions we hear most.</p>
          </div>
          <div className="ill rv">
            <AgreementScene />
          </div>
        </div>
      </header>

      <section className="band">
        {/* The reference narrows this band: a fourteen-row list at full width is a very long line. */}
        <div className="w" style={{ maxWidth: 780 }}>
          {HELP_TOPICS.map((topic, topicIndex) => (
            <div key={topic.heading} style={{ marginTop: topicIndex === 0 ? 0 : 40 }}>
              <h2 style={{ fontSize: 'clamp(20px,2.6vw,26px)', marginBottom: 8 }}>{topic.heading}</h2>
              {topic.questions.map(({ question, answer }, questionIndex) => (
                <details
                  key={question}
                  // The very first row starts open, as the FAQ band does: a list where every row is
                  // shut reads as a list of links rather than as an answer to anything.
                  open={topicIndex === 0 && questionIndex === 0}
                >
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          ))}

          <InfoBox style={{ marginTop: 28 }}>
            Still stuck?{' '}
            <Link href="/contact" style={{ fontWeight: 600, textDecoration: 'underline' }}>
              Contact us
            </Link>
            . We reply in about 15 minutes during the day.
          </InfoBox>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
