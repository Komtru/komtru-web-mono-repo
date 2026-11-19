import type { Metadata } from 'next';
import { HubScene } from '../../src/art/Illustrations';
import { Steps } from '../../src/chrome/Blocks';
import { CtaBand, type CtaCopy } from '../../src/chrome/CtaBand';
import styles from './hubs.module.css';

export const metadata: Metadata = {
  title: 'Collect where you already travel.',
  description:
    'Komtru park hubs in Lagos, Abuja, Port Harcourt and Jos: how a sealed parcel is handed over and collected.',
};

/**
 * How a hub pickup goes, word for word from the reference.
 *
 * Steps 2 and 3 are policy, not description: the inspection clock starts 12 hours after the
 * parcel lands at the hub, and the pickup PIN is shown to the agent and nobody else. Both are
 * quoted rather than paraphrased — the wording is what TrustOps enforces, and a looser retelling
 * here would be a second, slightly different rule.
 */
const PICKUP_STEPS = [
  { title: 'It arrives, sealed', body: 'The hub scans it in and photographs the seal.' },
  {
    title: 'You’re told',
    body: 'You get a message in Komtru, and your inspection time starts 12 hours later.',
  },
  {
    title: 'You show your PIN',
    body: 'Open the app for your pickup PIN. Only the agent should see it.',
  },
  { title: 'Check, then confirm', body: 'Check the seal and the item. Then confirm, or report a problem.' },
] as const;

/**
 * The cities with a hub planned.
 *
 * Deliberately not `LAUNCH_CITIES` from `src/site/nav.ts`. That list names the Plateau entry
 * "Plateau" — the state, which is what the home page's photo rail labels — and orders the four
 * for that rail. A hub is at a motor park in a named city, and the lede two lines above this list
 * says "Jos", so reusing the shared list would have the same band naming the same place two ways.
 * See the request at the end of this page's report.
 */
const PLANNED_HUBS = ['Lagos', 'Abuja', 'Jos', 'Port Harcourt'] as const;

/*
 * The reference closed this page with "Run a hub at your park", which scrolled to a partner
 * enquiry form (`#pfh`), and "Collect at a hub near you", which opened the app.
 *
 * Neither survives. There is no partner form in this app and there will not be one: the site
 * makes exactly one backend call, `POST /v1/waitlist`, and a second form means a second endpoint
 * (see `apps/web-site/CLAUDE.md`). A park owner who wants to host a hub is one conversation, not
 * a pipeline, so the action goes to `/contact` — the WhatsApp number and operations address in
 * `CONTACT` — and keeps its label, because that is still exactly what the button does.
 *
 * "Collect at a hub near you" pointed into a product nobody can reach yet, so it becomes the
 * waitlist, labelled as the waitlist. See `src/site/config.ts`.
 */
const CTA: CtaCopy = {
  heading: 'Collect at a hub near you when Komtru opens',
  body: 'Hand over or collect at a motor park in Lagos, Abuja, Port Harcourt or Jos.',
  actions: [
    { label: 'Run a hub at your park', to: '/contact' },
    { label: 'Join the waitlist', to: '/waitlist' },
  ],
};

/** Screen E8: the Park hubs page. */
export default function Hubs(): React.JSX.Element {
  return (
    <>
      <header className="ph cl">
        <div className="w split">
          <div>
            <h1>Collect where you already travel.</h1>
            <p className="lede">
              Motor-park hubs coordinate handover, tracking and collection for orders that don’t go to your
              door.
            </p>
          </div>
          <div className="ill rv">
            <HubScene />
          </div>
        </div>
      </header>

      <section className="band">
        <div className="w">
          <h2>How a pickup works</h2>
          <Steps steps={PICKUP_STEPS} />
        </div>
      </section>

      {/*
        One column, and grey where the reference had white. The reference paired this copy with
        the hub agent's app screens in a `.split`; that player is phase 3, and a half-width column
        of city names beside an empty half is worse than a full-width one. Grey because the band
        above it is now the white one the player used to justify.
      */}
      <section className="band cl">
        <div className="w">
          <h2>Where hubs are planned.</h2>
          <p className="lede">
            Komtru launches in Lagos, Port Harcourt, Jos and Abuja this December, and delivers across Nigeria.
          </p>
          <ul className={styles.hubs}>
            {PLANNED_HUBS.map((city) => (
              <li className={styles.hub} key={city}>
                <span>
                  {city}
                  <small>Launch city · December</small>
                </span>
                <span className={styles.chipg}>Launching</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand copy={CTA} />
    </>
  );
}
