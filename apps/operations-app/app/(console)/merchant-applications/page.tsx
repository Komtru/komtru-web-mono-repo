import type { Metadata } from 'next';
import { MerchantQueue } from '../../../src/merchant/MerchantQueue';

export const metadata: Metadata = { title: 'Merchant Applications' };

export default function Page(): React.JSX.Element {
  return <MerchantQueue />;
}
