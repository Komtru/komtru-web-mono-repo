// A `matchMedia` for the suites that draw the tablet and desktop layouts. jsdom has none, which is what keeps every
// other suite on the phone layout: both viewport hooks read "no matchMedia" as a phone. A suite may change the width
// after mount: every listener a component registered is told, as a real window resize would.
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export type Width = 'mobile' | 'tablet' | 'desktop';
const PX: Record<Width | 'phone', number> = { mobile: 390, phone: 390, tablet: 820, desktop: 1280 };

const listeners = new Set<() => void>();

/** Pretends the window is this wide. Pair with `unwidth()` (or `vi.unstubAllGlobals()`) in `afterEach`. */
export function atWidth(width: Width | 'phone'): void {
  const px = PX[width];
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min !== null && px >= Number(min[1]),
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
  act(() => {
    for (const listener of [...listeners]) listener();
  });
}

/** The name the fulfil and payouts suites use for `atWidth`. */
export const setWidth = atWidth;

export function unwidth(): void {
  listeners.clear();
  vi.unstubAllGlobals();
}
