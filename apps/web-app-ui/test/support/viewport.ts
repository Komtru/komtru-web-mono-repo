// Sets the width `matchMedia` answers for. jsdom has no layout, so a suite names the width it is testing.
import { vi } from 'vitest';

export type Width = 'phone' | 'tablet' | 'desktop';
const PX: Record<Width, number> = { phone: 390, tablet: 820, desktop: 1280 };

export function setWidth(width: Width): void {
  const px = PX[width];
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min !== null && px >= Number(min[1]),
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
