import type { Metadata } from 'next';
import { SellPayout } from '../../../../src/sell/Payout';

export const metadata: Metadata = { title: 'Payout account' };

/** SO4 (T-121): the payout account, and the step that sends the application. */
export default function SellPayoutPage(): React.JSX.Element {
  return <SellPayout />;
}
