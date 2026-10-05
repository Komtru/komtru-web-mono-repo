import type { Paginated } from '@komtru/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { collectCursorPages, flattenPages, nextPageParam, walkCursorPages } from '../src/pagination.js';

const page = (ids: string[], nextCursor: string | null): Paginated<{ id: string }> => ({
  items: ids.map((id) => ({ id })),
  nextCursor,
});

describe('nextPageParam', () => {
  it('stops when nextCursor is null, which is how the last page says so', () => {
    expect(nextPageParam(page([], null))).toBeUndefined();
  });

  it('passes a cursor through', () => {
    expect(nextPageParam(page(['a'], 'cursor-1'))).toBe('cursor-1');
  });
});

describe('flattenPages', () => {
  it('concatenates pages in order', () => {
    expect(flattenPages([page(['a', 'b'], 'c1'), page(['c'], null)])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
  });

  it('is empty for no pages', () => {
    expect(flattenPages([])).toEqual([]);
  });
});

describe('walkCursorPages', () => {
  it('walks every page, passing each cursor on, and stops at null', async () => {
    const fetchPage = vi
      .fn<(cursor: string | undefined) => Promise<Paginated<{ id: string }>>>()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockResolvedValueOnce(page(['b'], null));

    const seen: Paginated<{ id: string }>[] = [];
    for await (const got of walkCursorPages(fetchPage)) seen.push(got);

    expect(seen).toHaveLength(2);
    expect(fetchPage.mock.calls).toEqual([[undefined], ['c1']]);
  });

  it('collects every item across pages', async () => {
    const fetchPage = vi
      .fn<(cursor: string | undefined) => Promise<Paginated<{ id: string }>>>()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockResolvedValueOnce(page(['b'], null));
    await expect(collectCursorPages(fetchPage)).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('stops rather than looping when a server repeats a cursor', async () => {
    // A buggy server that always answers with the same nextCursor would otherwise spin forever.
    const fetchPage = vi.fn(() => Promise.resolve(page(['a'], 'same')));
    await expect(collectCursorPages(fetchPage)).resolves.toEqual([{ id: 'a' }, { id: 'a' }]);
    expect(fetchPage.mock.calls).toEqual([[undefined], ['same']]);
  });
});
