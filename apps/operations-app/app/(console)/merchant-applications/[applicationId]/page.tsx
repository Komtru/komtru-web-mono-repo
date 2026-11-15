import type { Metadata } from 'next';
import { MerchantCase } from '../../../../src/merchant/MerchantCase';

export const metadata: Metadata = { title: 'Merchant application' };

export default async function Page({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}): Promise<React.JSX.Element> {
  const { applicationId } = await params;
  return <MerchantCase applicationId={applicationId} />;
}
