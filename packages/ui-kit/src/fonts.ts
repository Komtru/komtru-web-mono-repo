// The three families the reference names, self-hosted by next/font from the files in `../fonts`, so
// no request leaves for Google at build time or at runtime. Each loader writes its family into the
// matching token variable, in front of the reference's fallbacks, so `var(--font-display)` keeps
// meaning the same thing.
//
// Why local files and not `next/font/google` (2026-11-20): the Google loader downloads the families
// during `next build`, and on GitHub's runners Google began answering with font URLs that have no
// file extension. Next's loader reads the extension off that URL and crashes ("Cannot read properties
// of null (reading '1')"), which failed operations-app's and web-app-ui's builds on staging. The
// files here are Google Fonts' own Latin woff2 subsets (SIL Open Font License): Inter and Space
// Grotesk as variable fonts, IBM Plex Mono at the three weights the reference uses. The paths are
// relative to this module, which Next resolves from `dist/fonts.js`, a sibling of `src/`.
//
// The Tailwind preset also declares `--font-display` and friends, but inside `@layer theme`, while
// next/font's `variable` class is unlayered — and unlayered CSS beats any layer. So the loaded
// webfont always wins on `<html className={fontVariables}>`. Do not "fix" the apparent duplication.
//
// This module is exported separately from the package root: `next/font/local` is rewritten by the
// Next compiler and throws when anything else imports it.
import localFont from 'next/font/local';

// Space Grotesk
export const displayFont = localFont({
  src: [{ path: '../fonts/space-grotesk-latin-400-700.woff2', weight: '400 700', style: 'normal' }],
  variable: '--font-display',
  fallback: ['Inter', 'sans-serif'],
  display: 'swap',
});

// Inter
export const bodyFont = localFont({
  src: [{ path: '../fonts/inter-latin-100-900.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-body',
  fallback: ['-apple-system', 'sans-serif'],
  display: 'swap',
});

// IBM Plex Mono
export const monoFont = localFont({
  src: [
    { path: '../fonts/ibm-plex-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/ibm-plex-mono-latin-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/ibm-plex-mono-latin-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
  fallback: ['SFMono-Regular', 'monospace'],
  display: 'swap',
});

/** For the root element: `<html className={fontVariables}>`. */
export const fontVariables = [displayFont.variable, bodyFont.variable, monoFont.variable].join(' ');
