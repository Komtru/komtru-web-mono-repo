// @vitest-environment jsdom
// F-044 (SP-M33): display and accessibility. Device preferences, applied to the page and kept on the device.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DisplayPrefsApplier } from '../src/account/display/DisplayPrefsApplier';
import { DisplayScreen } from '../src/account/display/DisplayScreen';
import { DISPLAY_STORAGE_KEY } from '../src/account/display/prefs';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES } from './support/trade';

beforeEach(() => {
  window.localStorage.clear();
  for (const name of [...document.documentElement.getAttributeNames()]) {
    if (name.startsWith('data-')) document.documentElement.removeAttribute(name);
  }
});
afterEach(cleanup);

const saved = () =>
  JSON.parse(window.localStorage.getItem(DISPLAY_STORAGE_KEY) ?? '{}') as Record<string, unknown>;

describe('Display & accessibility (SP-M33)', () => {
  it('draws the reference: text, comfort and data, with Low-data mode on and the rest off', () => {
    const { container } = render(<DisplayScreen />);
    expect(screen.getByRole('heading', { name: 'Display' })).toBeDefined();
    for (const group of ['Text', 'Comfort', 'Data'])
      expect(screen.getByRole('heading', { name: group })).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Medium/ }).checked).toBe(true);
    expect(screen.getByRole('switch', { name: 'Bold text' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Higher contrast' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Reduce motion' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Low-data mode' }).getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('switch', { name: 'Download photos on Wi-Fi only' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByText('Status is always shown with words as well as colour.')).toBeDefined();
    expect(screen.getByText(/saved on this device/)).toBeDefined();
    return expectNoAxeViolations(container, SHELL_RULES);
  });

  it('saves a change on the device and applies it to the page at once', () => {
    render(
      <>
        <DisplayPrefsApplier />
        <DisplayScreen />
      </>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Higher contrast' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    fireEvent.click(screen.getByRole('radio', { name: /Large/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Low-data mode' }));
    expect(saved()).toMatchObject({
      highContrast: true,
      reduceMotion: true,
      textSize: 'large',
      lowData: false,
    });
    expect(document.documentElement.dataset.contrast).toBe('high');
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(document.documentElement.dataset.textSize).toBe('large');
    expect(document.documentElement.dataset.lowData).toBeUndefined();
    expect(screen.getByRole('switch', { name: 'Higher contrast' }).getAttribute('aria-checked')).toBe('true');
  });

  it('opens with what was saved, and is still accessible with every switch on', async () => {
    window.localStorage.setItem(
      DISPLAY_STORAGE_KEY,
      JSON.stringify({
        textSize: 'small',
        boldText: true,
        highContrast: true,
        reduceMotion: true,
        lowData: true,
        wifiPhotosOnly: true,
      }),
    );
    const { container } = render(
      <>
        <DisplayPrefsApplier />
        <DisplayScreen />
      </>,
    );
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Small/ }).checked).toBe(true);
    expect(screen.getByRole('switch', { name: 'Bold text' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.boldText).toBe('on');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says where the Wi-Fi switch can and cannot work', () => {
    render(<DisplayScreen />);
    expect(screen.getByText(/Where your browser can tell mobile data from Wi-Fi/)).toBeDefined();
  });
});
