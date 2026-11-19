// A `matchMedia` for the suites that draw the tablet and desktop layouts. jsdom has none, which is what keeps every
// other suite on the phone layout: both viewport hooks read "no matchMedia" as a phone.
import { vi } from 'vitest';

export type Width = 'mobile' | 'tablet' | 'desktop';
const PX: Record<Width | 'phone', number> = { mobile: 390, phone: 390, tablet: 820, desktop: 1280 };

/** Pretends the window is this wide. Pair with `unwidth()` in `afterEach`. */
export function atWidth(width: Width | 'phone'): void {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min === null ? false : PX[width] >= Number(min[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  });
}

/** The name the fulfil and payouts suites use for `atWidth`. */
export const setWidth = atWidth;

export function unwidth(): void {
  vi.unstubAllGlobals();
}
