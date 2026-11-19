import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing on this site may send a visitor into the app.
 *
 * Komtru is not open. The app is deployed at app.komtru.com but its backend still runs a stub KYC
 * provider with notifications in dry-run, so someone who signed up there would wait forever for a
 * code that is never sent. The owner's instruction was to remove the way in, not to relabel it.
 *
 * This is a source scan rather than a render, because it has to cover the thirteen pages that are
 * still placeholders and every page written after them. The failure it exists to catch is someone
 * restoring a "Start a trade" button in six months without knowing why it went.
 *
 * To open the app, delete this file in the same commit that adds the buttons back — so the two
 * decisions are made together and reviewed together.
 */

const ROOT = join(import.meta.dirname, '..');

/** Every `.ts`/`.tsx` the site ships, excluding this test and the build output. */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'public') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sources(full));
    else if (/\.tsx?$/.test(entry) && !entry.startsWith('no-app-links')) found.push(full);
  }
  return found;
}

/** A line that is only a comment cannot render a link; the notes explaining this rule say these words. */
const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line);

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /app\.komtru\.com/, why: 'links to the app' },
  { pattern: /NEXT_PUBLIC_KOMTRU_APP_URL/, why: 'reads the app origin' },
  { pattern: /\bappLink\s*\(/, why: 'builds an app link' },
  { pattern: /href=["'][^"']*\/(login|signup)\b/, why: 'links to a sign-in or sign-up screen' },
  // The QR code and the two "coming soon" store badges went for the same reason as the buttons:
  // there is nothing to download, so they promise a product that does not exist yet.
  { pattern: /App Store|Google Play|qrcode-generator/, why: 'advertises an app store listing' },
];

describe('the marketing site', () => {
  const files = sources(join(ROOT, 'app')).concat(sources(join(ROOT, 'src')));

  it('has sources to scan', () => expect(files.length).toBeGreaterThan(10));

  it.each(FORBIDDEN)('never $why', ({ pattern }) => {
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!isComment(line) && pattern.test(line)) {
            hits.push(`${file.slice(ROOT.length + 1)}:${index + 1}  ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  /* The positive half: the header must still offer the one thing that does work. */
  it('offers the waitlist in the header', () => {
    const nav = readFileSync(join(ROOT, 'src/chrome/SiteNav.tsx'), 'utf8');
    expect(nav).toContain('Join the waitlist');
    expect(nav).toContain('href="/waitlist"');
  });
});
