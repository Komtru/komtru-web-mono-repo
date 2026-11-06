import type { Metadata } from 'next';
import { SectionPage } from '../../../src/shell/SectionPage';

export const metadata: Metadata = { title: 'Trades' };

export default function Page(): React.JSX.Element {
  return <SectionPage id="trades" />;
}
