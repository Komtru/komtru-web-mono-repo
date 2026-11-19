import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Talk to the Komtru team.',
  description: 'Contact Komtru by WhatsApp, email or in the app.',
};

export default function Page(): React.JSX.Element {
  return <ComingSoon title="Talk to the Komtru team." summary="Choose the fastest way to reach us." />;
}
