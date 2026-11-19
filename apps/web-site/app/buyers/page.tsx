import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Pay without blindly trusting a stranger.',
  description:
    'How Komtru protects a buyer: the agreement, the protected payment, the inspection window and the dispute process.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Pay without blindly trusting a stranger."
      summary="Your money stays protected until you have checked what arrived."
    />
  );
}
