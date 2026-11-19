'use client';

import { useViewport, type Viewport } from '../workspace/viewport';

/** The widths the app lays out at: `base` is a phone, `md` (768) a tablet and `lg` (1024) a desktop. */
export type ViewportTier = 'base' | 'md' | 'lg';

const TIER: Record<Viewport, ViewportTier> = { mobile: 'base', tablet: 'md', desktop: 'lg' };

/**
 * Which of the three layouts the window is in, named by breakpoint. For a screen whose structure differs by width (a
 * table, a list with a detail pane, plain rows), where CSS alone would draw two copies and hide one.
 *
 * One reading of the window serves the whole app: this is `useViewport` (`../workspace/viewport`) under the
 * breakpoint names, so the server and the first client render answer `base` and hydration agrees.
 */
export function useViewportTier(): ViewportTier {
  return TIER[useViewport()];
}
