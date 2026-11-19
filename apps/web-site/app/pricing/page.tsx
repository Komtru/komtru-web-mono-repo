import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Know exactly what you pay.',
  description: 'Komtru pricing: what a buyer pays, what a seller receives, and when the payment is released.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Know exactly what you pay."
      summary="Every fee is shown before you pay, on both sides of the trade."
    />
  );
}
