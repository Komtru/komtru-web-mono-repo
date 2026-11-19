import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../../src/trade/delivery/page';
import { ReportItem } from '../../../../../../src/trade/dispute/ReportItem';

/** F-032 (CWT-S17). */
export const metadata: Metadata = { title: 'Report an issue' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({ params, render: (id) => <ReportItem id={id} /> });
}
