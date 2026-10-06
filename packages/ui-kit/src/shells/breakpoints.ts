/**
 * The three widths the reference states for itself, in two `.breakpoint-note` blocks:
 * "base (mobile, 0px) → sm (640px) → md (768px, tablet top-nav kicks in) → lg (1024px, desktop
 * sidebar + split-view kicks in)". They are Tailwind v4's own defaults, so no shell declares a
 * custom screen; `test/shells/breakpoints.test.ts` re-reads both notes and fails if either moves.
 *
 * Tailwind writes those defaults in `rem` (`40rem`/`48rem`/`64rem`), not `px`. At the 16px root the
 * reference assumes they are exactly these pixel widths; at a larger root font size every
 * breakpoint moves with the text, which is the behaviour a reader who has scaled their type wants
 * and the reason the defaults are not overridden here.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
} as const satisfies Record<string, number>;

/** The names the reference uses, and the Tailwind variant prefix each one is. */
export type Breakpoint = keyof typeof BREAKPOINTS;
