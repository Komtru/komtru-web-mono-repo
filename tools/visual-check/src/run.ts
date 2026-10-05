// The whole check, end to end: locate, carve, shoot both sides in one browser, score, write.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeSideBySide, diffPngs } from './diff.ts';
import { carveScreen } from './reference.ts';
import { mergeStub, renderStub } from './report.ts';
import { shootBuilt, shootReference, withBrowser } from './render.ts';
import { findScreen, loadScreens, REFERENCE_HTML_PATH } from './screen-index.ts';

/** Where the ticket says the artefacts live. */
export const UI_REVIEW_DIR = fileURLToPath(new URL('../../../docs/ui-review/', import.meta.url));

export interface VisualCheckOptions {
  screen: string;
  url: string;
  outDir?: string;
  /** Disambiguates the one id the reference draws twice. */
  line?: number;
  threshold?: number;
}

export interface VisualCheckResult {
  screen: string;
  ticket: string;
  ratio: number;
  changed: number;
  total: number;
  compared: { width: number; height: number };
  sideBySide: string;
  heatMap: string;
  markdown: string;
}

export async function visualCheck(options: VisualCheckOptions): Promise<VisualCheckResult> {
  const html = readFileSync(REFERENCE_HTML_PATH, 'utf8');
  const row = findScreen(loadScreens(), options.screen, options.line);
  const carved = carveScreen(html, row);

  const { reference, built } = await withBrowser(async (browser) => {
    const shot = await shootReference(browser, carved);
    return {
      reference: shot,
      built: await shootBuilt(browser, options.url, { width: shot.width, height: shot.height }),
    };
  });

  const diff = diffPngs(reference.png, built.png, { threshold: options.threshold ?? 0.1 });

  const directory = join(options.outDir ?? UI_REVIEW_DIR, row.ticket);
  mkdirSync(directory, { recursive: true });

  const files = { sideBySide: `${row.id}.png`, heatMap: `${row.id}.diff.png` };
  const sideBySide = join(directory, files.sideBySide);
  const heatMap = join(directory, files.heatMap);
  const markdown = join(directory, `${row.id}.md`);

  writeFileSync(sideBySide, composeSideBySide([reference.png, built.png, diff.heatMap]));
  writeFileSync(heatMap, diff.heatMap);

  const fresh = renderStub({
    row,
    url: options.url,
    device: carved.device,
    frameWidth: carved.width,
    compared: { width: diff.width, height: diff.height },
    diff,
    capturedAt: new Date(),
    files,
  });
  let existing = '';
  try {
    existing = readFileSync(markdown, 'utf8');
  } catch {
    // First run for this screen: there is no review to keep.
  }
  writeFileSync(markdown, mergeStub(existing, fresh));

  return {
    screen: row.id,
    ticket: row.ticket,
    ratio: diff.ratio,
    changed: diff.changed,
    total: diff.total,
    compared: { width: diff.width, height: diff.height },
    sideBySide,
    heatMap,
    markdown,
  };
}
