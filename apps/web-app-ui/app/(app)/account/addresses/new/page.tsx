import type { Metadata } from 'next';
import { AddressForm } from '../../../../../src/account/addresses/AddressForm';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Add an address' };

export const dynamic = 'force-dynamic';

/** SP-M02 (F-044): add an address. A static route, so it takes precedence over `[id]`. */
export default function NewAddressPage(): React.JSX.Element {
  return (
    <AccountScreen section="addresses">
      <AddressForm />
    </AccountScreen>
  );
}
