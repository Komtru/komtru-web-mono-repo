import type { Metadata } from 'next';
import { AddressList } from '../../../../src/account/addresses/AddressList';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Saved addresses' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SP-M01 (F-044): where you receive items. */
export default function AddressesPage(): React.JSX.Element {
  return (
    <AccountScreen section="addresses">
      <AddressList />
    </AccountScreen>
  );
}
