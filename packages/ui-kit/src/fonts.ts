// The three families the reference names, loaded and self-hosted by next/font so no request leaves
// for Google at runtime. Each loader writes its own family name into the matching token variable,
// in front of the reference's fallbacks, so `var(--font-display)` keeps meaning the same thing.
//
// The Tailwind preset also declares `--font-display` and friends, but inside `@layer theme`, while
// next/font's `variable` class is unlayered — and unlayered CSS beats any layer. So the loaded
// webfont always wins on `<html className={fontVariables}>`. Do not "fix" the apparent duplication.
//
// This module is exported separately from the package root: `next/font/google` is rewritten by the
// Next compiler and throws when anything else imports it.
import { IBM_Plex_Mono, Inter, Space_Grotesk } from 'next/font/google';

export const displayFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  fallback: ['Inter', 'sans-serif'],
  display: 'swap',
});

export const bodyFont = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  fallback: ['-apple-system', 'sans-serif'],
  display: 'swap',
});

export const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  fallback: ['SFMono-Regular', 'monospace'],
  display: 'swap',
});

/** For the root element: `<html className={fontVariables}>`. */
export const fontVariables = [displayFont.variable, bodyFont.variable, monoFont.variable].join(' ');
