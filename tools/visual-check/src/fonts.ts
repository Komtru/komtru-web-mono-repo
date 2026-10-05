// The one decision that makes a diff worth reading.
//
// `tokens.css` names 'Space Grotesk', 'Inter' and 'IBM Plex Mono' but ships no `@font-face`; only a
// Next build loads them, through `@komtru/ui-kit/fonts`. So the reference renders in whatever the
// machine falls back to while the built app renders in the real faces, and every diff would be a
// wall of typography noise with the actual deviations buried in it.
//
// Masking text was rejected: in a design-system build most deviations *are* text. Linking Google
// Fonts at screenshot time was rejected: a network round-trip makes the diff irreproducible offline
// and lets the upstream file change without the repository changing. Instead the three families are
// exact-pinned dependencies — the same Google-generated `latin` WOFF2 files `next/font/google`
// self-hosts in the apps — inlined into *both* pages. Both sides then have all three faces
// available and only the markup decides which one applies, so a screen that reaches for the wrong
// family still shows up as a deviation.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

interface FontFace {
  family: string;
  /** The WOFF2 on disk, resolved through the package rather than a guessed `node_modules` path. */
  file: string;
  /** A single weight, or a variable font's range. */
  weight: string;
}

const file = createRequire(import.meta.url).resolve;

/** Matches `packages/ui-kit/src/fonts.ts`: latin subset, and the weights each loader asks for. */
export const FONT_FACES: readonly FontFace[] = [
  {
    family: 'Space Grotesk',
    file: file('@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2'),
    weight: '300 700',
  },
  {
    family: 'Inter',
    file: file('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
    weight: '100 900',
  },
  ...(['400', '500', '600'] as const).map((weight) => ({
    family: 'IBM Plex Mono',
    file: file(`@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-${weight}-normal.woff2`),
    weight,
  })),
];

const fontFace = ({ family, file: path, weight }: FontFace): string => {
  const data = readFileSync(path).toString('base64');
  return [
    '@font-face {',
    `  font-family: '${family}';`,
    '  font-style: normal;',
    `  font-weight: ${weight};`,
    // `block` rather than `swap`: a swapped fallback frame is exactly the typography noise this
    // module exists to remove, and `document.fonts.ready` is awaited before anything is captured.
    '  font-display: block;',
    `  src: url(data:font/woff2;base64,${data}) format('woff2');`,
    '}',
  ].join('\n');
};

/**
 * Injected into the reference page and the built page alike. The second half is the other half of
 * "a flagged pixel is a real deviation": a transition caught mid-frame or a blinking caret is a
 * difference between two runs, not between two designs.
 */
export function fontStylesheet(): string {
  return [
    ...FONT_FACES.map(fontFace),
    '*, *::before, *::after {',
    '  animation: none !important;',
    '  transition: none !important;',
    '  caret-color: transparent !important;',
    '}',
    '',
  ].join('\n');
}
