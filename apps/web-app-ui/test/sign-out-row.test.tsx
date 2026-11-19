// @vitest-environment jsdom
// The way out of a session. There was none before this row: `signOut()` existed and only Close
// Account called it, so the only way to leave was to delete the account.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn<() => Promise<void>>();
vi.mock('../src/entry/session-calls', () => ({ signOut: (): Promise<void> => signOut() }));

const assign = vi.fn();

beforeEach(() => {
  signOut.mockReset().mockResolvedValue(undefined);
  assign.mockReset();
  vi.stubGlobal('location', { assign, href: 'https://app.komtru.test/account' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const { SignOutRow } = await import('../src/shell/SignOutRow');

describe('SignOutRow', () => {
  it('is a button, not a link — it does something rather than going somewhere', () => {
    render(<SignOutRow />);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('ends the session and leaves', async () => {
    render(<SignOutRow />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });

  /*
   * A full document load, not a client navigation. Routing in place would leave the previous
   * person's trades, messages and account data in the React tree and the query cache — which is
   * the thing someone signing out on a borrowed phone is trying to prevent.
   */
  it('reloads the document rather than routing in place', async () => {
    render(<SignOutRow />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });

  it('cannot be fired twice by a double tap', async () => {
    let release: (() => void) | undefined;
    signOut.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    render(<SignOutRow />);
    const button = screen.getByRole('button', { name: 'Sign out' });

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Signing out…' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Signing out…' }));

    expect(signOut).toHaveBeenCalledTimes(1);
    release?.();
  });
});
