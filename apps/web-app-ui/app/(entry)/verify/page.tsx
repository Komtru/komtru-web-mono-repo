import type { Metadata } from 'next';
import { VerifyForm } from '../../../src/entry/components/VerifyForm';

export const metadata: Metadata = { title: 'Enter code' };

export default function VerifyPage(): React.JSX.Element {
  return <VerifyForm />;
}
