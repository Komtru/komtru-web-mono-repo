// @vitest-environment jsdom
// F-045: the way into AS1 and AS2 from Account.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusNotice } from '../src/account/StatusNotice';
import { me } from './support/account';
import { answerWith, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('StatusNotice', () => {
  it('points a suspended buyer at AS1 and a suspended seller at AS2', async () => {
    answerWith(api.call, { 'GET /me': me({ status: 'SUSPENDED' }) });
    renderWithApi(api.call, <StatusNotice />);
    expect((await screen.findByRole('link', { name: 'See what this means' })).getAttribute('href')).toBe(
      '/account/suspended',
    );
    cleanup();
    renderWithApi(api.call, <StatusNotice seller />);
    expect((await screen.findByRole('link', { name: 'See what this means' })).getAttribute('href')).toBe(
      '/account/suspended/selling',
    );
  });

  it('says nothing to an account in good standing, or while it cannot tell', async () => {
    answerWith(api.call, { 'GET /me': me() });
    const { container } = renderWithApi(api.call, <StatusNotice />);
    await vi.waitFor(() => expect(api.call).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup();
    answerWith(api.call, { 'GET /me': new Error('down') });
    const failed = renderWithApi(api.call, <StatusNotice />);
    await vi.waitFor(() => expect(api.call).toHaveBeenCalled());
    expect(failed.container.textContent).toBe('');
  });
});
