import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AddressForm } from '../../../../../src/account/addresses/AddressForm';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Edit address' };

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SP-M02 (F-044): edit an address. */
export default async function EditAddressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <AccountScreen section="addresses">
      <AddressForm addressId={id} />
    </AccountScreen>
  );
}
