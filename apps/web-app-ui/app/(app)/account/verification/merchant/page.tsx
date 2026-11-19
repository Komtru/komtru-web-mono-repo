import type { Metadata } from 'next';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';
import { SellVerification } from '../../../../../src/sell/Verification';

export const metadata: Metadata = { title: 'Merchant verification' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/**
 * M2 and BVR1 (T-121): the merchant verification tab, under Account › Verification. Every state the application can
 * be in is drawn here, and the way into the verification flow is on this screen.
 */
export default function MerchantVerificationPage(): React.JSX.Element {
  return (
    <AccountScreen section="verification">
      <SellVerification />
    </AccountScreen>
  );
}
