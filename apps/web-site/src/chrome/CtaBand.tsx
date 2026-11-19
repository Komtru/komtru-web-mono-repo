import Link from 'next/link';
import { appLink } from '../site/config';

export interface CtaAction {
  readonly label: string;
  /** An app screen, a site path, or an anchor on this page. */
  readonly to: { app: '/login' | '/signup' } | { site: string };
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
          {copy.actions.map((action, index) => {
            const className = `btn ${index === 0 ? 'bw' : 'bsd'}`;
            return 'app' in action.to ? (
              <a key={action.label} className={className} href={appLink(action.to.app)}>
                {action.label}
              </a>
            ) : (
              <Link key={action.label} className={className} href={action.to.site}>
                {action.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Screen E1's own closing band. */
export const HOME_CTA: CtaCopy = {
  heading: 'Complete your next trade with komtru',
  body: 'It takes a few minutes to set up. Nothing is charged until you accept an agreement.',
  actions: [
    { label: 'Start a trade', to: { app: '/signup' } },
    { label: 'How it works', to: { site: '/how-it-works' } },
  ],
};
