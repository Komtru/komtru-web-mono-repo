import type { Metadata } from 'next';
import { SellStart } from '../../../../src/sell/Start';

export const metadata: Metadata = { title: 'Become a seller' };

/** SO1 (T-121): the first of the five Become a Seller screens, at the reference's URL. */
export default function SellStartPage(): React.JSX.Element {
  return <SellStart />;
}
