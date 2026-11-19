import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Got a code? Check it yourself.',
  description:
    'Check a Komtru Trade Code. Search the code yourself rather than tapping a payment link from a stranger.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Got a code? Check it yourself."
      summary="Open Komtru on your own and search the Trade. No payment links from strangers."
    />
  );
}
