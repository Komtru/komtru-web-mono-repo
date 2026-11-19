import Link from 'next/link';

export interface CtaAction {
  readonly label: string;
  /**
   * A path on this site. There is no variant for an app screen, on purpose: while Komtru is
   * closed nothing here may send a visitor into the product, and a type that cannot express it
   * is a stronger guarantee than a rule someone has to remember. See `src/site/config.ts`.
   */
  readonly to: string;
}

export interface CtaCopy {
  readonly heading: string;
  readonly body: string;
  readonly actions: readonly [CtaAction, CtaAction];
}

/**
 * The closing band, on every page.
 *
 * The reference gives each page its own heading and pair of buttons — "Complete your next purchase
 * with komtru" on the buyers page, "Still have a question?" on Help — so the copy is a parameter
 * rather than a constant. The first action is the solid white button, the second the outlined one.
 */
export function CtaBand({ copy }: { copy: CtaCopy }): React.JSX.Element {
  return (
    <div className="band dk" style={{ textAlign: 'center' }}>
      <div className="w">
        <h2>{copy.heading}</h2>
        <p className="lede" style={{ margin: '14px auto 0' }}>
          {copy.body}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {copy.actions.map((action, index) => (
            <Link key={action.label} className={`btn ${index === 0 ? 'bw' : 'bsd'}`} href={action.to}>
              {action.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Screen E1's own closing band.
 *
 * The reference's heading was "Complete your next trade with komtru" over a "Start a trade"
 * button. Neither is true yet, and a closing band is the last thing someone reads — so it says
 * what they can actually do today.
 */
export const HOME_CTA: CtaCopy = {
  heading: 'Be first in when Komtru opens',
  body: 'Komtru isn’t open yet. Join the waitlist and we’ll tell you the day your city goes live.',
  actions: [
    { label: 'Join the waitlist', to: '/waitlist' },
    { label: 'How it works', to: '/how-it-works' },
  ],
};
