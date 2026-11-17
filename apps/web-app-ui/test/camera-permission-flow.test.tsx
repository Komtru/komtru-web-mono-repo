// @vitest-environment jsdom
// F-044 (SP-M18): the camera is explained just before it is first needed. This is the real sheet over the real camera
// hook: only the browser's `getUserMedia` and `permissions` are stood in for, because jsdom has neither.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraSheet } from '../src/trade/proof/CameraSheet';
import { expectNoAxeViolations } from './axe';

const EXPLAINED = 'komtru.camera.explained';

const browser = (permission?: 'granted' | 'denied' | 'prompt') => {
  const stop = vi.fn();
  const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] }));
  vi.stubGlobal('navigator', {
    onLine: true,
    mediaDevices: { getUserMedia },
    ...(permission === undefined
      ? {}
      : {
          permissions: {
            query: () =>
              Promise.resolve({
                state: permission,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
              }),
          },
        }),
  });
  return { getUserMedia };
};

const sheet = (onClose = vi.fn(), onPick = vi.fn()) =>
  render(
    <CameraSheet
      open
      onClose={onClose}
      photosTaken={0}
      onShot={vi.fn()}
      onPick={onPick}
      videoNeeded={false}
      onVideo={vi.fn()}
    />,
  );

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Camera permission (SP-M18) in the proof camera', () => {
  it('shows neither the explainer nor the camera until the browser has answered, so an allowed camera never flashes it', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const stop = vi.fn();
    const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] }));
    vi.stubGlobal('navigator', {
      onLine: true,
      mediaDevices: { getUserMedia },
      permissions: {
        query: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    });
    sheet();
    const dialog = await screen.findByRole('dialog', { name: 'Take photos' });
    expect(within(dialog).getByText('Getting the camera ready…')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Allow the camera' })).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    answer({ state: 'granted', addEventListener: () => undefined, removeEventListener: () => undefined });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    // It went straight to the camera: the explainer was never drawn.
    expect(screen.queryByRole('heading', { name: 'Allow the camera' })).toBeNull();
  });

  it('explains first and does not touch the camera until the person says so', async () => {
    const { getUserMedia } = browser('prompt');
    sheet();
    const dialog = await screen.findByRole('dialog', { name: 'Take photos' });
    expect(within(dialog).getByRole('heading', { name: 'Allow the camera' })).toBeDefined();
    await expectNoAxeViolations(dialog);
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow the camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(EXPLAINED)).toBe('1');
  });

  it('explains where the browser cannot say either way, which is most of Safari', async () => {
    const { getUserMedia } = browser(undefined);
    sheet();
    expect(await screen.findByRole('heading', { name: 'Allow the camera' })).toBeDefined();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('"Not now" leaves the camera unasked and offers the gallery instead', async () => {
    const { getUserMedia } = browser('prompt');
    const onPick = vi.fn();
    sheet(vi.fn(), onPick);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('No problem')).toBeDefined();
    expect(screen.getByText('Choose photos you took earlier from your gallery instead.')).toBeDefined();
    expect(getUserMedia).not.toHaveBeenCalled();
    // A refusal here is not a permanent one: nothing was remembered, so it is explained again next time.
    expect(window.localStorage.getItem(EXPLAINED)).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Take photos' });
    expect(within(dialog).getByText('Choose from my gallery')).toBeDefined();
    await expectNoAxeViolations(dialog);
  });

  it('does not explain what the browser already allows, or has already blocked', async () => {
    const allowed = browser('granted');
    sheet();
    await waitFor(() => expect(allowed.getUserMedia).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Allow the camera' })).toBeNull();
    cleanup();
    const blocked = browser('denied');
    sheet();
    // Blocked is not explained again: the camera is tried, and the browser's refusal is what the sheet then says.
    await waitFor(() => expect(blocked.getUserMedia).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Allow the camera' })).toBeNull();
  });

  it('says it once per device', async () => {
    window.localStorage.setItem(EXPLAINED, '1');
    const { getUserMedia } = browser('prompt');
    sheet();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Allow the camera' })).toBeNull();
  });
});
