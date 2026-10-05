// `SCREEN_INDEX.md` is the only map from a screen id to its place in the reference HTML, and
// `scripts/test/screen-index.test.ts` keeps it true against the HTML itself. This module reads it
// the same way, so the harness and that test cannot disagree about what a row means.
import { readFileSync } from 'node:fs';

import { REFERENCE_FILE } from '@komtru/ui-kit/extract-tokens';

/** The design reference, resolved from this package rather than the caller's working directory. */
export const REFERENCE_DIR = new URL('../../../docs/design-reference/', import.meta.url);

export const REFERENCE_HTML_PATH = new URL(REFERENCE_FILE, REFERENCE_DIR);

export const SCREEN_INDEX_PATH = new URL('SCREEN_INDEX.md', REFERENCE_DIR);

/** One row of the index: a screen, where it lives in the HTML, and who builds it. */
export interface ScreenRow {
  id: string;
  screen: string;
  /** The reference's own heading for the group of screens this one belongs to. */
  section: string;
  /** The line in the HTML where the screen's `screen-num` header starts. */
  line: number;
  app: string;
  /** The cell verbatim: one row annotates the ticket ("T-110 (intentionally not built …)"). */
  ticket: string;
}

/**
 * The ticket id alone, which is what names the output directory. One row's cell carries prose and
 * a `§`, and that must not become a directory name.
 */
export function ticketId(row: ScreenRow): string {
  const id = /^T-\d{3}/.exec(row.ticket)?.[0];
  if (id === undefined) throw new Error(`${row.id} names no ticket: ${row.ticket}`);
  return id;
}

export function parseScreenIndex(markdown: string): ScreenRow[] {
  return markdown
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
}

export function loadScreens(): ScreenRow[] {
  return parseScreenIndex(readFileSync(SCREEN_INDEX_PATH, 'utf8'));
}

/**
 * The row for `id`. `TO-PA10` is two rows — the reference draws that screen twice, and the index
 * header says so — so an ambiguous id is an error the caller resolves with `--line` rather than a
 * coin toss between two different pictures.
 */
export function findScreen(rows: readonly ScreenRow[], id: string, line?: number): ScreenRow {
  const matches = rows.filter((row) => row.id === id && (line === undefined || row.line === line));
  const [first] = matches;
  if (first === undefined) {
    const where = line === undefined ? '' : ` at line ${line}`;
    throw new Error(`No screen ${id}${where} in SCREEN_INDEX.md`);
  }
  if (matches.length > 1) {
    throw new Error(
      `${id} appears ${matches.length} times in SCREEN_INDEX.md (lines ${matches
        .map((row) => row.line)
        .join(', ')}). Pass --line to choose one.`,
    );
  }
  return first;
}
