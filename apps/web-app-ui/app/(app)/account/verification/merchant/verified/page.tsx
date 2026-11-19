import type { Metadata } from 'next';
import { AccountScreen } from '../../../../../../src/shell/AccountScreen';
import { SellLive } from '../../../../../../src/sell/Live';

export const metadata: Metadata = { title: 'Verified merchant' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SO5 (T-121): the approved outcome. Inside the account frame, with Verification as the current section. */
export default function MerchantVerifiedPage(): React.JSX.Element {
  return (
    <AccountScreen section="verification">
      <SellLive />
    </AccountScreen>
  );
}
