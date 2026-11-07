import type { Metadata } from 'next';
import { ProposalCheckIn } from '../../../../src/cases/ProposalCheckIn';

export const metadata: Metadata = { title: 'Proposal check-in' };

export default function Page(): React.JSX.Element {
  return <ProposalCheckIn />;
}
