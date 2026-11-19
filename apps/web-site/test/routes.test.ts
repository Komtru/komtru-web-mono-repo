import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOOTER_COLUMNS, NAV_LINKS } from '../src/site/nav';

/**
 * Every link in the chrome points at a page that exists.
 *
 * The header and the footer are written once and rendered on all seventeen pages, so a path that
 * goes stale is not one broken link, it is one broken link on every page of the site. This is the
 * check that notices, and it works off the route tree rather than a second list to keep in step.
 */

const APP_DIR = join(import.meta.dirname, '..', 'app');

/** Every route the `app` directory serves, as a path. Route groups and dynamic segments are out of
 *  scope: this site has neither. */
function routes(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'page.tsx') found.push(prefix === '' ? '/' : prefix);
    else if (statSync(full).isDirectory()) found.push(...routes(full, `${prefix}/${entry}`));
  }
  return found;
}

describe('the site’s own links', () => {
  const served = new Set(routes(APP_DIR));

  it('serves every page the header links to', () => {
    for (const { href, label } of NAV_LINKS) {
      expect(served.has(href), `header link “${label}” → ${href}`).toBe(true);
    }
  });

  it('serves every page the footer links to', () => {
    for (const column of FOOTER_COLUMNS) {
      for (const { href, label } of column.links) {
        expect(served.has(href), `footer link “${label}” → ${href}`).toBe(true);
      }
    }
  });

  it('serves the waitlist, which the QR code and every unset call to action point at', () => {
    expect(served.has('/waitlist')).toBe(true);
  });
});
