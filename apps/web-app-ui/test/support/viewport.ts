// Sets the width `matchMedia` answers for. jsdom has no layout, so a suite names the width it is testing, and may
// change it after mount: every listener a component registered is told, as a real window resize would.
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export type Width = 'phone' | 'tablet' | 'desktop';
const PX: Record<Width, number> = { phone: 390, tablet: 820, desktop: 1280 };

const listeners = new Set<() => void>();

export function setWidth(width: Width): void {
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
