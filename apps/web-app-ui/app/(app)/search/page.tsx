import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveViewer } from '../../../src/shell/viewer';
import { SearchTrades } from '../../../src/home/SearchTrades';

export const metadata: Metadata = { title: 'Search' };

/**
 * SE1 and SE2: search the person's own trades. The shell's search bar sends a plain query here as `?q=`, so the
 * first query is read from the address; the screen is keyed by it so a new search starts fresh.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const { q } = await searchParams;
  const initialQuery = typeof q === 'string' ? q : '';
  const viewer = await resolveViewer();

  return (
    <AppShell tab="discover" viewer={viewer}>
      <SearchTrades key={initialQuery} initialQuery={initialQuery} />
    </AppShell>
  );
}
