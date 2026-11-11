import type { Metadata } from 'next';
import { Payouts } from '../../../../src/payouts/Payouts';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Payouts' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/**
 * Seller-6 (F-037): the available balance, how the seller is paid, and their payouts. Under Account, as T-124 says:
 * anyone who has sold has money to collect, not only a merchant.
 */
export default function PayoutsPage(): React.JSX.Element {
  return (
    <AccountScreen section="payouts">
      <Payouts />
    </AccountScreen>
  );
}
