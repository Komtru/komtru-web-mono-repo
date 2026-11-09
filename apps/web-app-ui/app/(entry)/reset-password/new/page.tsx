import type { Metadata } from 'next';
import { ResetPasswordForm } from '../../../../src/entry/components/PasswordReset';

export const metadata: Metadata = { title: 'New password' };

export default function ResetPasswordPage(): React.JSX.Element {
  return <ResetPasswordForm />;
}
