import { redirect } from 'next/navigation';

/**
 * Discover's old destination. The catalogue and category browse are deferred with the listings, so `/browse` no
 * longer exists as a screen; discovery is trade search (F-015). A bookmarked `?q=` still lands on its results.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}): Promise<never> {
  const { q } = await searchParams;
  const query = typeof q === 'string' && q.trim() !== '' ? `?q=${encodeURIComponent(q)}` : '';
  redirect(`/search${query}`);
}
