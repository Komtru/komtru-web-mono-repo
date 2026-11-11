import type { Metadata } from 'next';
import { PayoutAccounts } from '../../../../../src/payouts/PayoutAccounts';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Payout Account' };

export const dynamic = 'force-dynamic';

/** AB6 (F-037): the bank accounts a seller is paid into. A static route, ahead of `[id]`. */
export default function PayoutAccountPage(): React.JSX.Element {
  return (
    <AccountScreen section="payouts">
      <PayoutAccounts />
    </AccountScreen>
  );
}
