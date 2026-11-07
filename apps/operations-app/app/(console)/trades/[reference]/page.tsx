import type { Metadata } from 'next';
import { TradeView } from '../../../../src/cases/TradeView';

export const metadata: Metadata = { title: 'Trade' };

export default async function Page({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<React.JSX.Element> {
  const { reference } = await params;
  return <TradeView reference={decodeURIComponent(reference)} />;
}
