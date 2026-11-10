import type { Metadata } from 'next';
import { PeopleQueue } from '../../../src/identity/PeopleQueue';

export const metadata: Metadata = { title: 'People' };

export default function Page(): React.JSX.Element {
  return <PeopleQueue />;
}
