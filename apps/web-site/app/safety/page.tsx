import type { Metadata } from 'next';
import Link from 'next/link';
import { AgreementScene } from '../../src/art/Illustrations';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import styles from './comparison.module.css';

export const metadata: Metadata = {
  title: 'Safer social commerce, built on evidence',
  description:
    'Komtru reduces the risk in a social deal with agreements, protected payments and human review. We don’t promise fraud can never happen.',
};

/** The four things that differ between a deal done in a chat and a trade done on Komtru. */
const COMPARISON = [
  { label: 'Payment', ordinary: 'Straight to the seller', komtru: 'Protected under the agreement' },
  { label: 'Terms', ordinary: 'Personal assurances', komtru: 'Documented and accepted by both sides' },
  { label: 'Item evidence', ordinary: 'Photos can change', komtru: 'Fixed for reference' },
  {
    label: 'Problems',
    ordinary: 'No structured process',
    komtru: 'Documented review, decision and one appeal',
  },
];

// Rule for the whole site: no button leads into the app. The reference closed this page with
// "Start a trade"; the waitlist is the thing someone can actually do today.
const CTA: CtaCopy = {
  heading: 'Trade with evidence on your side when Komtru opens',
  body: 'Agreements, protected payments and human review, from start to finish.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'How it works', to: '/how-it-works' },
  ],
};

/**
 * The safety page.
 *
 * The lede is the one claim this site is careful about: it says what Komtru does and stops there.
 * Don't upgrade "we reduce risk" into "you are safe" — the sentence is written the way it is on
 * purpose.
 */
export default function Safety(): React.JSX.Element {
  return (
    <>
      <header className="ph band cl">
        <div className="w split">
          <div>
            <h1>Safer social commerce, built on evidence.</h1>
            <p className="lede">
              We reduce risk with agreements, protected payments and human review. We don’t promise fraud can
              never happen.
            </p>
          </div>
          <div className="ill rv">
            <AgreementScene />
          </div>
        </div>
      </header>

      <section className="band">
        <div className="w">
          <h2>Ordinary social deal vs. a Komtru trade.</h2>
          {/*
            Focusable, because on a narrow screen the table is wider than the band and a keyboard
            has no other way to reach the right-hand column.
          */}
          <div
            className={styles.scroll}
            role="region"
            aria-label="An ordinary social deal compared with a Komtru trade"
            tabIndex={0}
          >
            <table className={styles.cmp}>
              <thead>
                <tr>
                  <td />
                  <th scope="col">Ordinary social deal</th>
                  <th scope="col">Komtru trade</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(({ label, ordinary, komtru }) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{ordinary}</td>
                    <td>{komtru}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/*
        The reference ran the phone-screen walkthrough of a dispute here, and its lede — "Follow a
        reported problem on both sides of the table" — pointed straight at it. The player is phase
        3, so this is one column, and the lede says what the process is rather than inviting
        someone to follow a walkthrough that isn't on the page.
      */}
      <section className="band cl">
        <div className="w">
          <h2>From problem to decision, in the open.</h2>
          <p className="lede">
            A reported problem is documented, reviewed by a person against the agreement both sides accepted,
            decided, and open to one appeal.
          </p>
        </div>
      </section>

      <section className="band is">
        <div className="w">
          <h2>Spot a scam?</h2>
          <p className="lede">
            Never pay a seller outside Komtru for a trade. Search the Trade Code yourself.
          </p>
          <div className="row">
            <Link className="btn bp" href="/contact">
              Report a scam
            </Link>
            {/* A link, not a button: the reference's modal is a page here. */}
            <Link className="btn bs" href="/trade-code">
              Enter trade code
            </Link>
          </div>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
