import type { Metadata } from 'next';
import { ForgotPasswordForm } from '../../../src/entry/components/PasswordReset';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage(): React.JSX.Element {
  return <ForgotPasswordForm />;
}
