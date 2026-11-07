import type { Metadata } from 'next';
import { CaseDetail } from '../../../../../src/cases/CaseDetail';

export const metadata: Metadata = { title: 'Case' };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return <CaseDetail caseId={id} />;
}
