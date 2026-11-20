import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../../src/shell/viewer';
import { FundTrade } from '../../../../../src/trade/funding/FundTrade';

export const metadata: Metadata = { title: 'Fund & Protect' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-024 (V1, V2, V3, AB3, AB4): the buyer pays into escrow. One address for every step, because the step is the
 * platform's payment state; a static route, so it takes precedence over `/trade/[id]/[tab]`.
 */
export default async function FundTradePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ via?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const { via } = await searchParams;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <FundTrade id={id} {...(via === 'transfer' ? { via } : {})} />
    </AppShell>
  );
}
