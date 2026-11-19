import type { Metadata } from 'next';
import { SellVerifyBusiness } from '../../../../../../src/sell/VerifyBusiness';

export const metadata: Metadata = { title: 'Business verification' };

/** SO3 (T-121): the CAC number and the documents a merchant application cannot be sent without. */
export default function SellVerifyBusinessPage(): React.JSX.Element {
  return <SellVerifyBusiness />;
}
