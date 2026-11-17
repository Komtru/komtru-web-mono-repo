// @vitest-environment jsdom
// F-044 (SP-M33): Low-data mode and "Wi-Fi only" change what a file tile does, not just what a switch says.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPLAY_STORAGE_KEY, DEFAULT_PREFS } from '../src/account/display/prefs';
import { MediaGrid } from '../src/trade/proof/MediaGrid';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, id, renderWithApi, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

const FILES: Record<string, unknown> = {
  [id(1)]: { fileId: id(1), url: 'https://files.test/1.jpg', expiresAt: null, contentType: 'image/jpeg' },
  [id(2)]: { fileId: id(2), url: 'https://files.test/2.mp4', expiresAt: null, contentType: 'video/mp4' },
};

const setPrefs = (over: Record<string, unknown>) =>
  window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({ ...DEFAULT_PREFS, ...over }));
const setConnection = (type: string | undefined) =>
  Object.defineProperty(window.navigator, 'connection', {
    configurable: true,
    value: type === undefined ? undefined : { type },
  });

beforeEach(() => {
  api.call.mockReset();
  window.localStorage.clear();
  answerWith(api.call, {
    'GET /files/:id': (input: { params?: { id?: string } }) => FILES[input.params?.id ?? ''],
  });
});
afterEach(() => {
  cleanup();
  setConnection(undefined);
});

const grid = (
  <MediaGrid
    aria-label="Files"
    items={[
      { id: 'a', fileId: id(1), label: 'Photo 1' },
      { id: 'b', fileId: id(2), label: 'Video 1' },
    ]}
  />
);

describe('Low-data mode on a file tile', () => {
  it('lets a photo load as it scrolls in, and holds a video until it is played', async () => {
    renderWithApi(api.call, grid);
    const photo = await screen.findByAltText('Photo 1');
    expect(photo.getAttribute('loading')).toBe('lazy');
    expect(screen.getByLabelText('Video 1').getAttribute('preload')).toBe('none');
  });

  it('draws them the ordinary way once it is off', async () => {
    setPrefs({ lowData: false });
    renderWithApi(api.call, grid);
    const photo = await screen.findByAltText('Photo 1');
    expect(photo.getAttribute('loading')).toBeNull();
    expect(screen.getByLabelText('Video 1').getAttribute('preload')).toBe('metadata');
  });
});

describe('Download photos on Wi-Fi only', () => {
  it('holds a photo back on mobile data until it is tapped', async () => {
    setPrefs({ wifiPhotosOnly: true });
    setConnection('cellular');
    const { container } = renderWithApi(api.call, grid);
    const load = await screen.findByRole('button', { name: 'Load Photo 1' });
    expect(screen.queryByAltText('Photo 1')).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(load);
    expect(await screen.findByAltText('Photo 1')).toBeDefined();
  });

  it('does nothing on Wi-Fi, or where the browser cannot say', async () => {
    setPrefs({ wifiPhotosOnly: true });
    setConnection('wifi');
    renderWithApi(api.call, grid);
    expect(await screen.findByAltText('Photo 1')).toBeDefined();
    cleanup();
    setConnection(undefined);
    renderWithApi(api.call, grid);
    expect(await screen.findByAltText('Photo 1')).toBeDefined();
  });
});
