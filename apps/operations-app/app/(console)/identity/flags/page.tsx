import type { Metadata } from 'next';
import { PeopleQueue } from '../../../../src/identity/PeopleQueue';

export const metadata: Metadata = { title: 'Duplicate flags' };

export default function Page(): React.JSX.Element {
  return <PeopleQueue view="flags" />;
}
