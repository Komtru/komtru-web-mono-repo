import type { Metadata } from 'next';
import { MyWork } from '../../../../src/cases/MyWork';

export const metadata: Metadata = { title: 'My work' };

export default function Page(): React.JSX.Element {
  return <MyWork />;
}
