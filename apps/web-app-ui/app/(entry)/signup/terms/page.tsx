import type { Metadata } from 'next';
import { TermsForm } from '../../../../src/entry/components/TermsForm';

export const metadata: Metadata = { title: 'Terms & Privacy' };

export default function SignUpTermsPage(): React.JSX.Element {
  return <TermsForm />;
}
