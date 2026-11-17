import type { Metadata } from 'next';
import { Refunds } from '../../../../src/account/refunds/Refunds';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Where’s my refund?' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SP-M12 (F-044): a refund as a journey, from the buyer's own refunds. */
export default function RefundsPage(): React.JSX.Element {
  return (
    <AccountScreen section="refunds">
      <Refunds />
    </AccountScreen>
  );
}
