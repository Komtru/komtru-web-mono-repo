import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Get paid for honest trades.',
  description:
    'How Komtru works for sellers: verified identity, a buyer who has already paid, and a record that follows you.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Get paid for honest trades."
      summary="Your customers want to buy. They just do not know if they can trust you yet."
    />
  );
}
