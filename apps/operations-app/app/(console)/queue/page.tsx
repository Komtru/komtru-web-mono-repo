import type { Metadata } from 'next';
import { Today } from '../../../src/cases/Today';

export const metadata: Metadata = { title: 'Today' };

export default function Page(): React.JSX.Element {
  return <Today />;
}
