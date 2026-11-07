import type { Metadata } from 'next';
import { Alerts } from '../../../../src/cases/Alerts';

export const metadata: Metadata = { title: 'Alerts & escalations' };

export default function Page(): React.JSX.Element {
  return <Alerts />;
}
