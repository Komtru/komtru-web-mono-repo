import Link from 'next/link';
import { HeroBackdrop, HeroForeground, HeroNetwork } from '../art/Illustrations';
import { PhoneFrame } from './PhoneFrame';
import { FindATradeScreen } from './FindATradeScreen';

/**
 * Screen E1's hero.
 *
 * "Enter trade code" is a link to `/trade-code` rather than a dialog. The reference opened a modal
 * holding the same form the Trade Code page already has; one URL for one thing is both less code
 * and a page someone can be sent to, which is exactly what a seller does with it.
 *
 * The reference's second button was "Start a trade", into the app. The app is not open, so it is
 * the waitlist and says so — see the note in `src/site/config.ts`.
 */
export function Hero(): React.JSX.Element {
  return (
    <header className="hero">
      <HeroNetwork />
      <div className="w g">
        <div style={{ padding: '40px 0' }}>
          <h1>
            Helping people online buy and sell,{' '}
            <span style={{ color: 'var(--trust-emerald)' }}>protected.</span>
          </h1>
          <p className="lede">
            Komtru protects your payment until the item you agreed is delivered. Sellers get paid for the
            Trades they honour. Both sides build a record that people can see and trust.
          </p>
          <div className="row">
            <Link className="btn bs" href="/trade-code">
              Enter trade code
            </Link>
            <Link className="btn bp" href="/waitlist">
              Join the waitlist
            </Link>
          </div>
        </div>
        <div className="hz">
          <div className="hh">
            <HeroBackdrop />
            <PhoneFrame>
              <FindATradeScreen />
            </PhoneFrame>
            <HeroForeground />
          </div>
        </div>
      </div>
    </header>
  );
}
