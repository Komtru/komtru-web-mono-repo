import type { Metadata } from 'next';
import { VerificationCase } from '../../../../src/identity/VerificationCase';

export const metadata: Metadata = { title: 'Verification case' };

export default async function Page({
  params,
}: {
  params: Promise<{ requestId: string }>;
}): Promise<React.JSX.Element> {
  const { requestId } = await params;
  return <VerificationCase requestId={requestId} />;
}
