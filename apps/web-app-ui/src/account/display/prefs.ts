// SP-M33: how Komtru looks and loads on this device. These are preferences of a device, not of an account: nothing
// here is sent to the platform, so they live in this browser's own storage and are applied as attributes on `<html>`
// (`globals.css` reads them). Pure functions over a `Storage` and an element, so the rules are tested without a screen.
export const DISPLAY_STORAGE_KEY = 'komtru.display';
/** Fired on `window` when preferences change in this tab, so every part of the page reads them again. */
export const DISPLAY_CHANGED = 'komtru:display-changed';

export const TEXT_SIZES = ['small', 'medium', 'large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface DisplayPrefs {
  textSize: TextSize;
  boldText: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  /** Smaller loads on any network: no video is fetched until it is played, and photos load as they scroll in. */
  lowData: boolean;
  /** Hold photos back on mobile data until they are tapped. Only where the browser can say which network it is on. */
  wifiPhotosOnly: boolean;
}

/** The reference draws Low-data mode on by default ("because low bandwidth is a first-class case"). */
export const DEFAULT_PREFS: DisplayPrefs = {
  textSize: 'medium',
  boldText: false,
  highContrast: false,
  reduceMotion: false,
  lowData: true,
  wifiPhotosOnly: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whatever storage holds, one field at a time: a field that is not what it should be is its default. */
export function parsePrefs(raw: string | null): DisplayPrefs {
  if (raw === null) return DEFAULT_PREFS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (!isRecord(parsed)) return DEFAULT_PREFS;
  const flag = (key: Exclude<keyof DisplayPrefs, 'textSize'>): boolean =>
    typeof parsed[key] === 'boolean' ? parsed[key] : DEFAULT_PREFS[key];
  const size = TEXT_SIZES.find((candidate) => candidate === parsed.textSize);
  return {
    textSize: size ?? DEFAULT_PREFS.textSize,
    boldText: flag('boldText'),
    highContrast: flag('highContrast'),
    reduceMotion: flag('reduceMotion'),
    lowData: flag('lowData'),
    wifiPhotosOnly: flag('wifiPhotosOnly'),
  };
}

export function readPrefs(): DisplayPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(DISPLAY_STORAGE_KEY));
  } catch {
    // Storage can be blocked outright. The defaults are a working app.
    return DEFAULT_PREFS;
  }
}

/** Saved for next time and announced to this tab. A storage that refuses still changes this visit. */
export function writePrefs(prefs: DisplayPrefs): void {
  try {
    window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or a full disk: the preference lasts until the page is closed, and that is all it can do.
  }
  window.dispatchEvent(new Event(DISPLAY_CHANGED));
}

/** An attribute is only present while its preference is off its default, so the stylesheet's default stays the default. */
export function applyPrefs(root: HTMLElement, prefs: DisplayPrefs): void {
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) root.removeAttribute(`data-${name}`);
    else root.setAttribute(`data-${name}`, value);
  };
  set('text-size', prefs.textSize === 'medium' ? undefined : prefs.textSize);
  set('bold-text', prefs.boldText ? 'on' : undefined);
  set('contrast', prefs.highContrast ? 'high' : undefined);
  set('motion', prefs.reduceMotion ? 'reduced' : undefined);
  set('low-data', prefs.lowData ? 'on' : undefined);
}

/** The slice of the Network Information API this reads. Only some browsers (Chrome on Android) implement it. */
export interface NetworkInformationLike {
  type?: string;
}

/** True only when the browser says the connection is cellular. A browser that cannot say is never guessed at. */
export const onMobileData = (connection: NetworkInformationLike | undefined): boolean =>
  connection?.type === 'cellular';
