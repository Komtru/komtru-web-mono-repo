// F-015: `/browse` is the deferred catalogue's old address; it sends people to trade search and keeps their query.
import { describe, expect, it, vi } from 'vitest';
import BrowsePage from '../app/(app)/browse/page';

const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect: nav.redirect }));

const visit = (q?: string | string[]) =>
  BrowsePage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) });

describe('/browse', () => {
  it('goes to trade search', async () => {
    await expect(visit()).rejects.toThrow('NEXT_REDIRECT /search');
  });

  it('keeps a query, encoded, so an old search link still lands on its results', async () => {
    await expect(visit('iphone 13 & case')).rejects.toThrow(
      'NEXT_REDIRECT /search?q=iphone%2013%20%26%20case',
    );
  });

  it('drops an empty or repeated query rather than sending it on', async () => {
    await expect(visit('   ')).rejects.toThrow('NEXT_REDIRECT /search');
    await expect(visit(['a', 'b'])).rejects.toThrow('NEXT_REDIRECT /search');
  });
});
