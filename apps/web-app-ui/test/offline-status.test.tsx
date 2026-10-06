// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OfflineStatus } from '../src/shell/OfflineStatus';

/** jsdom reports `navigator.onLine` as true and has no way to change it. */
const setOnline = (online: boolean): void => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
};

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe('OfflineStatus', () => {
  it('draws nothing while there is a connection', () => {
    const { container } = render(<OfflineStatus />);
    expect(container.innerHTML).toBe('');
  });

  it('appears the moment the connection drops, without a reload', () => {
    render(<OfflineStatus />);
    setOnline(false);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain("You're offline");
    // The second sentence is the one that matters: what is on screen is still real, just older.
    expect(banner.textContent).toContain('Showing your last saved data');
  });

  it('goes away again when the connection comes back', () => {
    render(<OfflineStatus />);
    setOnline(false);
    expect(screen.queryByRole('status')).not.toBeNull();
    setOnline(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
