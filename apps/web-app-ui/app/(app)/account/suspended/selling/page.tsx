import type { Metadata } from 'next';
import { Suspended } from '../../../../../src/account/Suspended';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Selling suspended' };

/** Per request: the rail is a fact about the person signed in. */
export const dynamic = 'force-dynamic';

/** AS2 (F-045): the seller's view. The reference marks Account as the tab, so the Account frame is used. */
export default function SellingSuspendedPage(): React.JSX.Element {
  return (
    <AccountScreen>
      <Suspended seller />
    </AccountScreen>
  );
}
