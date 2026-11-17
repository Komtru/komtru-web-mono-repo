// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFS,
  DISPLAY_STORAGE_KEY,
  applyPrefs,
  onMobileData,
  parsePrefs,
  readPrefs,
  writePrefs,
} from '../src/account/display/prefs';

beforeEach(() => {
  window.localStorage.clear();
  for (const name of [...document.documentElement.getAttributeNames()]) {
    if (name.startsWith('data-')) document.documentElement.removeAttribute(name);
  }
});

describe('parsePrefs', () => {
  it('reads what was saved', () => {
    expect(parsePrefs(JSON.stringify({ ...DEFAULT_PREFS, textSize: 'large', lowData: false }))).toEqual({
      ...DEFAULT_PREFS,
      textSize: 'large',
      lowData: false,
    });
  });

  it('falls back to the defaults for anything it cannot trust, one field at a time', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('[1,2]')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ textSize: 'huge', boldText: 'yes', highContrast: true }))).toEqual({
      ...DEFAULT_PREFS,
      highContrast: true,
    });
  });
});

describe('read and write', () => {
  it('round-trips through the device’s own storage and nothing else', () => {
    writePrefs({ ...DEFAULT_PREFS, reduceMotion: true });
    expect(window.localStorage.getItem(DISPLAY_STORAGE_KEY)).not.toBeNull();
    expect(readPrefs().reduceMotion).toBe(true);
  });

  it('survives a storage that refuses (private mode), and says nothing', () => {
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      expect(() => writePrefs(DEFAULT_PREFS)).not.toThrow();
    } finally {
      refuse.mockRestore();
    }
  });
});

describe('applyPrefs', () => {
  it('puts each preference on <html> as an attribute the stylesheet reads', () => {
    applyPrefs(document.documentElement, {
      textSize: 'large',
      boldText: true,
      highContrast: true,
      reduceMotion: true,
      lowData: true,
      wifiPhotosOnly: false,
    });
    const root = document.documentElement;
    expect(root.dataset.textSize).toBe('large');
    expect(root.dataset.boldText).toBe('on');
    expect(root.dataset.contrast).toBe('high');
    expect(root.dataset.motion).toBe('reduced');
    expect(root.dataset.lowData).toBe('on');
  });

  it('takes an attribute away when its preference goes back to the default', () => {
    applyPrefs(document.documentElement, { ...DEFAULT_PREFS, boldText: true, textSize: 'large' });
    applyPrefs(document.documentElement, { ...DEFAULT_PREFS, textSize: 'medium' });
    expect(document.documentElement.dataset.boldText).toBeUndefined();
    expect(document.documentElement.dataset.textSize).toBeUndefined();
  });
});

describe('onMobileData', () => {
  it('is true only when the browser itself says the connection is cellular', () => {
    expect(onMobileData(undefined)).toBe(false);
    expect(onMobileData({})).toBe(false);
    expect(onMobileData({ type: 'wifi' })).toBe(false);
    expect(onMobileData({ type: 'cellular' })).toBe(true);
  });
});
