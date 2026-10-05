// SCREEN_INDEX.md is the map from the design reference to the tickets that build each screen, and
// the visual-check harness (T-016) navigates by its line numbers. It was generated once during
// planning; this test is what keeps it true as the reference and the ticket list move.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const referenceDir = join(root, 'docs', 'design-reference');
const html = readFileSync(join(referenceDir, 'Komtru — UI Screens Living Master File.html'), 'utf8');
const indexMd = readFileSync(join(referenceDir, 'SCREEN_INDEX.md'), 'utf8');

/** The five frontends; `backend-api` has no screens. */
const APPS = ['web-app-ui', 'operations-app', 'logistics-ops', 'park-agent-app'] as const;

/**
 * The reference numbers the customer and seller tab screens 1–10; the index prefixes them C and S,
 * as its own header note explains, so that the ids are unique across 210 rows.
 */
const TAB_PREFIXED = /^[CS](\d+)$/;

interface Row {
  id: string;
  screen: string;
  section: string;
  line: number;
  app: string;
  ticket: string;
}

const rows: Row[] = indexMd
  .split('\n')
  .filter((line) => line.startsWith('|') && !line.startsWith('|---') && !line.startsWith('| ID '))
  .map((line) => {
    const [id, screen, section, lineNumber, app, ticket] = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    return {
      id: id ?? '',
      screen: screen ?? '',
      section: section ?? '',
      line: Number(lineNumber),
      app: app ?? '',
      ticket: ticket ?? '',
    };
  });

const decodeEntities = (value: string): string =>
  value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"');

/** Every screen in the reference, by the `screen-num` header that opens it. */
const screensInHtml = html.split('\n').flatMap((line, i) => {
  const match = /<div class="screen-num"><div class="n">([^<]+)<\/div><div><b>([^<]*)<\/b>/.exec(line);
  return match ? [{ id: match[1]!.trim(), name: decodeEntities(match[2]!.trim()), line: i + 1 }] : [];
});

const ticketIds = new Set(
  readFileSync(join(root, 'docs', 'TICKETS.md'), 'utf8')
    .split('\n')
    .flatMap((line) => /\b(T-\d{3})\b/.exec(line)?.[1] ?? []),
);

describe('SCREEN_INDEX.md against the reference HTML', () => {
  it('covers every screen in the reference and invents none', () => {
    expect(screensInHtml).toHaveLength(210);
    expect(rows).toHaveLength(screensInHtml.length);
    expect(rows.map((row) => row.line).sort((a, b) => a - b)).toEqual(
      screensInHtml.map((screen) => screen.line).sort((a, b) => a - b),
    );
  });

  it('names each screen as the reference names it', () => {
    const byLine = new Map(screensInHtml.map((screen) => [screen.line, screen]));
    for (const row of rows) {
      expect(byLine.get(row.line)?.name, `${row.id} at line ${row.line}`).toBe(row.screen);
    }
  });

  it("uses the reference's own ids, prefixing only the numbered customer and seller tabs", () => {
    const byLine = new Map(screensInHtml.map((screen) => [screen.line, screen]));
    for (const row of rows) {
      const inHtml = byLine.get(row.line)?.id;
      const prefixed = TAB_PREFIXED.exec(row.id);
      expect(prefixed ? prefixed[1] : row.id, `${row.id} at line ${row.line}`).toBe(inHtml);
    }
  });

  it('maps every screen to one app that exists', () => {
    for (const row of rows) expect(APPS, `${row.id}`).toContain(row.app);
  });

  it('maps every screen to one ticket that exists', () => {
    for (const row of rows) {
      // One row names a screen the design deliberately drops; it says so instead of pointing at a
      // ticket that will never be built (design §6.3).
      const ticket = /^(T-\d{3})/.exec(row.ticket)?.[1];
      expect(ticket, `${row.id} ticket cell: ${row.ticket}`).toBeDefined();
      expect(ticketIds, `${row.id} → ${row.ticket}`).toContain(ticket);
    }
  });

  it('gives each ticket screens from a single app', () => {
    const appsByTicket = new Map<string, Set<string>>();
    for (const row of rows) {
      appsByTicket.set(row.ticket, (appsByTicket.get(row.ticket) ?? new Set()).add(row.app));
    }
    for (const [ticket, apps] of appsByTicket) expect([...apps], ticket).toHaveLength(1);
  });

  it('repeats an id only where the reference itself shows one screen twice', () => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    const repeated = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
    // TO-PA10 appears as two variants of one screen; the index header says so.
    expect(repeated).toEqual(['TO-PA10']);
  });
});
