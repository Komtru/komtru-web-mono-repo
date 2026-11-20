import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveViewer } from '../../../src/shell/viewer';
import { FindTrade } from '../../../src/home/FindTrade';

export const metadata: Metadata = { title: 'Find a Trade' };

/**
 * F1 and F2: enter a Trade Code and see the trade it names, if it is one the person may see. A code in the address
 * (`?code=`) is looked up as it arrives, which is how the search screen hands a code over.
 */
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const { code } = await searchParams;
  const initialCode = typeof code === 'string' ? code : undefined;
  const viewer = await resolveViewer();

  return (
    <AppShell tab="discover" viewer={viewer}>
      <FindTrade key={initialCode ?? ''} {...(initialCode === undefined ? {} : { initialCode })} />
    </AppShell>
  );
}
