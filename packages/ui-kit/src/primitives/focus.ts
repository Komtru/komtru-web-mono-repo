/**
 * The reference puts one ring on everything: `:focus-visible{outline:2.5px solid var(--trust-indigo);
 * outline-offset:2px; border-radius:4px}`. The radius is deliberately left out — that global rule is
 * declared before every component rule, so any element with its own `border-radius` keeps it, and
 * baking 4px into a utility would invert the cascade and square off chips and sheets while focused.
 */
export const FOCUS_RING_UTILITIES = [
  'outline-[2.5px]',
  'outline-trust-indigo',
  'outline-offset-[2px]',
] as const;

/** Spread onto any primitive that can take keyboard focus. */
export const FOCUS_RING = FOCUS_RING_UTILITIES.map((utility) => `focus-visible:${utility}`).join(' ');
