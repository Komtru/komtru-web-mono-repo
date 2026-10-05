// The durable half of a review. The PNGs are regenerated on every run and are not committed; this
// file is, because the deviation list is what the next reader needs and it diffs as text.
import { REFERENCE_FILE } from '@komtru/ui-kit/extract-tokens';

import type { Device } from './frames.ts';
import type { ScreenRow } from './screen-index.ts';

export interface StubInput {
  row: ScreenRow;
  url: string;
  device: Device;
  /** The width the reference declares for this screen's frame. */
  frameWidth: number;
  compared: { width: number; height: number };
  diff: { changed: number; total: number; ratio: number };
  files: { sideBySide: string; heatMap: string };
}

const DEVIATIONS = '## Deviations';

/** Anchored: `### Deviations by area` must not be mistaken for the boundary. */
const DEVIATIONS_HEADING = /^## Deviations$/m;

const percent = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`;

export function renderStub(input: StubInput): string {
  const { row, diff, compared } = input;
  return [
    `# ${row.id} — ${row.screen} (${row.ticket})`,
    '',
    `- **Reference:** \`docs/design-reference/${REFERENCE_FILE}\` line ${row.line} — ${row.section}`,
    `- **Built:** ${input.url}`,
    `- **Frame:** ${input.device}, ${input.frameWidth}px reference frame; compared at ${compared.width} × ${compared.height}`,
    `- **Differing pixels:** ${diff.changed.toLocaleString('en-GB')} of ${diff.total.toLocaleString('en-GB')} (${percent(diff.ratio)})`,
    `- **Side by side:** \`${input.files.sideBySide}\` (reference · built · heat map) — **heat map:** \`${input.files.heatMap}\``,
    '',
    DEVIATIONS,
    '',
    '<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.',
    '     Everything below this comment survives the next run; everything above it is regenerated. -->',
    '',
  ].join('\n');
}

/**
 * A second run refreshes the metadata and keeps whatever a reviewer wrote under `## Deviations`.
 * Overwriting the file wholesale would silently delete the review this file exists to hold — so
 * when the heading has been renamed or removed, the old body is carried over whole rather than
 * dropped. Losing a review is the one failure this function must never have.
 */
export function mergeStub(existing: string, fresh: string): string {
  if (existing.trim() === '') return fresh;

  const head = fresh.slice(0, fresh.search(DEVIATIONS_HEADING));
  const kept = existing.search(DEVIATIONS_HEADING);
  if (kept !== -1) return head + existing.slice(kept);

  return `${head}${DEVIATIONS}\n\n<!-- The heading below went missing; everything under it is the\n     previous review, kept verbatim. Re-file it under this heading. -->\n\n${existing.trim()}\n`;
}
