import type { Metadata } from 'next';
import { MyAccount } from '../../../src/components/MyAccount';

export const metadata: Metadata = { title: 'My account' };

export default function Page(): React.JSX.Element {
  return <MyAccount />;
}
