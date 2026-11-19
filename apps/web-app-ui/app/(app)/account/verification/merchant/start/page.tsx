import type { Metadata } from 'next';
import { SellStart } from '../../../../../../src/sell/Start';

export const metadata: Metadata = { title: 'Your business' };

/** SO1 (T-121): the first step of merchant verification (the reference's first screen of its flow). */
export default function SellStartPage(): React.JSX.Element {
  return <SellStart />;
}
