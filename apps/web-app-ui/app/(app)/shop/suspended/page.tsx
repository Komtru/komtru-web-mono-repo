import type { Metadata } from 'next';
import { Suspended } from '../../../../src/account/Suspended';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Shop suspended' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** AS2 (F-045): the seller's view. The reference marks Account as the tab, so the Account frame is used. */
export default function ShopSuspendedPage(): React.JSX.Element {
  return (
    <AccountScreen>
      <Suspended seller />
    </AccountScreen>
  );
}
