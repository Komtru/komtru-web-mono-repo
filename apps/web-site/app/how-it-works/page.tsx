import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'A trade, from agreement to payout.',
  description:
    'How a Komtru trade works, from the agreement both sides accept to the payout the seller receives.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="A trade, from agreement to payout."
      summary="Follow a protected trade step by step, exactly as it appears in the Komtru app."
    />
  );
}
