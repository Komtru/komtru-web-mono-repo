import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveViewer } from '../../../src/shell/viewer';
import { HomeScreen } from '../../../src/home/HomeScreen';

export const metadata: Metadata = { title: 'Home' };

/** Z1, H-01, Customer-1 and the empty states AC1 and H-03: the person's own trades, at a glance. */
export default async function HomePage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell tab="home" viewer={viewer}>
      <HomeScreen />
    </AppShell>
  );
}
