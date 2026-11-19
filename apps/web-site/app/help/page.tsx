import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Questions, answered.',
  description: 'Answers to common questions about Komtru trades, payments, inspection times and disputes.',
};

export default function Page(): React.JSX.Element {
  return <ComingSoon title="Questions, answered." summary="Quick answers to the questions we hear most." />;
}
