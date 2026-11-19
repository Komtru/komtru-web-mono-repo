import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Facts, not a score.',
  description:
    'The Komtru Trust Passport: a shareable record of completed trades, verification and resolved problems.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Facts, not a score."
      summary="Completed trades, verification and how problems were handled. Shareable on Instagram, WhatsApp and proposals."
    />
  );
}
