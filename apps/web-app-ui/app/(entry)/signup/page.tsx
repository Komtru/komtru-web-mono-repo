import type { Metadata } from 'next';
import { SignUpForm } from '../../../src/entry/components/SignUpForm';

export const metadata: Metadata = { title: 'Create account' };

export default function SignUpPage(): React.JSX.Element {
  return <SignUpForm />;
}
