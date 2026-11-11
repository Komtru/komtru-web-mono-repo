import type { Metadata } from 'next';
import { Withdraw } from '../../../../../src/payouts/Withdraw';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Withdraw' };

export const dynamic = 'force-dynamic';

/** AB5 (F-037): withdraw from the available balance to a verified account. A static route, ahead of `[id]`. */
export default function WithdrawPage(): React.JSX.Element {
  return (
    <AccountScreen section="payouts">
      <Withdraw />
    </AccountScreen>
  );
}
