// The one decision that makes a diff worth reading.
//
// `tokens.css` names 'Space Grotesk', 'Inter' and 'IBM Plex Mono' but ships no `@font-face`; only a
// Next build loads them, through `@komtru/ui-kit/fonts`. So the reference renders in whatever the
// machine falls back to while the built app renders in the real faces, and every diff would be a
// wall of typography noise with the actual deviations buried in it.
//
// Masking text was rejected: in a design-system build most deviations *are* text. Linking Google
// Fonts at screenshot time was rejected: a network round-trip makes the diff irreproducible offline
// and lets the upstream file change without the repository changing.
//
// Since 2026-11-20 ui-kit owns the files (`packages/ui-kit/fonts`, loaded by `next/font/local`), and
// this reads the very same ones and inlines them into *both* pages. Both sides then have all three
// faces available, byte-identical to what the app ships, and only the markup decides which one
// applies, so a screen that reaches for the wrong family still shows up as a deviation. next/font
// renders the built app under a generated family name of its own, which is why these are declared
// again here under the reference's names.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface FontFace {
  family: string;
  /** The WOFF2 on disk, resolved through the package rather than a guessed `node_modules` path. */
  file: string;
  /** A single weight, or a variable font's range. */
  weight: string;
}

/** ui-kit's committed font files: the ones `packages/ui-kit/src/fonts.ts` hands to next/font/local. */
const file = (name: string): string =>
  fileURLToPath(new URL(`../../../packages/ui-kit/fonts/${name}`, import.meta.url));

/** Matches `packages/ui-kit/src/fonts.ts`: the same files, at the same weights or weight ranges. */
export const FONT_FACES: readonly FontFace[] = [
  { family: 'Space Grotesk', file: file('space-grotesk-latin-400-700.woff2'), weight: '400 700' },
  { family: 'Inter', file: file('inter-latin-100-900.woff2'), weight: '100 900' },
  ...(['400', '500', '600'] as const).map((weight) => ({
    family: 'IBM Plex Mono',
    file: file(`ibm-plex-mono-latin-${weight}.woff2`),
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
