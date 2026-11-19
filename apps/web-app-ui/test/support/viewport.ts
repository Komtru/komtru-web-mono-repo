// A `matchMedia` for the suites that draw the tablet and desktop layouts. jsdom has none, which is what keeps every
// other suite on the phone layout: `useViewport` reads "no matchMedia" as a phone.
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export type Width = 'mobile' | 'tablet' | 'desktop';
const PX: Record<Width, number> = { mobile: 390, tablet: 820, desktop: 1280 };

let current: Width = 'mobile';
const listeners = new Set<() => void>();

/** Pretends the window is this wide. Pair with `unwidth()` in `afterEach`. */
export function atWidth(width: Width): void {
  current = width;
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const list = {
      get matches() {
        return min === null ? false : PX[current] >= Number(min[1]);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
    return list as unknown as MediaQueryList;
  });
}

/** The window is resized while the screen is open: a rotated tablet, a dragged window. */
export function resizeTo(width: Width): void {
  current = width;
  act(() => {
    listeners.forEach((listener) => {
      listener();
    });
  });
}

export function unwidth(): void {
  listeners.clear();
  current = 'mobile';
  vi.unstubAllGlobals();
}

/** The card a `Panel` draws around its heading: the screens name panels by heading, not by landmark. */
export function panelOf(heading: HTMLElement): HTMLElement {
  const card = heading.parentElement?.parentElement;
  if (card === null || card === undefined) throw new Error('A panel heading sits in a panel');
  return card;
}
