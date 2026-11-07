import type { Metadata } from 'next';
import { TeamQueue } from '../../../../src/cases/TeamQueue';

export const metadata: Metadata = { title: 'Team queue' };

export default function Page(): React.JSX.Element {
  return <TeamQueue />;
}
