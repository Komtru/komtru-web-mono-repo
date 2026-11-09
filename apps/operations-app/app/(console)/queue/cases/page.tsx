import type { Metadata } from 'next';
import { CasesList } from '../../../../src/cases/CasesList';

export const metadata: Metadata = { title: 'Cases' };

export default function Page(): React.JSX.Element {
  return <CasesList />;
}
