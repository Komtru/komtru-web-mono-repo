import type { Metadata } from 'next';
import { FullTerms } from '../../../src/entry/components/TermsScreens';

export const metadata: Metadata = { title: 'Terms of Service and Privacy Policy' };

export default function TermsPage(): React.JSX.Element {
  return <FullTerms />;
}
