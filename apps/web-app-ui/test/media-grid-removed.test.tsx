// @vitest-environment jsdom
// A file staff removed (tombstoned, 410) is said to be removed and offers no retry; any other failure still does.
import { ProblemError } from '@komtru/api-client';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaGrid } from '../src/trade/proof/MediaGrid';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, id, renderWithApi, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
});

const meta = { requestId: undefined, retryAfterMs: undefined, rateLimit: undefined, replayed: false };

describe('a file tile whose file was removed', () => {
  it('says it was removed, with no retry, and leaves the other tiles alone', async () => {
    const gone = new ProblemError(
      { type: 'about:blank', title: 'Gone', status: 410, code: 'FILE_TOMBSTONED' },
      { status: 410, ...meta },
      false,
    );
    answerWith(api.call, {
      'GET /files/:id': (input: { params?: { id?: string } }) =>
        input.params?.id === id(1)
          ? gone
          : { fileId: id(2), url: 'https://files.test/2.jpg', expiresAt: null, contentType: 'image/jpeg' },
    });
    const { container } = renderWithApi(
      api.call,
      <MediaGrid
        aria-label="Files"
        items={[
          { id: 'a', fileId: id(1), label: 'Delivery file 1' },
          { id: 'b', fileId: id(2), label: 'Delivery file 2' },
        ]}
      />,
    );
    expect(await screen.findByText('Delivery file 1 was removed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(await screen.findByAltText('Delivery file 2')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
