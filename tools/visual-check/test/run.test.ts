// End to end, against the reference itself: the same screen on both sides must score zero, and a
// deliberately altered copy must not. Browser-gated, like every other suite that launches Chromium.
import { createServer, type Server } from 'node:http';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseRootTokens } from '@komtru/ui-kit/extract-tokens';

import { carveScreen } from '../src/reference.ts';
import { visualCheck } from '../src/run.ts';
import { findScreen, loadScreens, REFERENCE_HTML_PATH } from '../src/screen-index.ts';

const enabled = process.env.KOMTRU_BROWSER_TESTS === '1';
const html = readFileSync(REFERENCE_HTML_PATH, 'utf8');
const rows = loadScreens();
const tokens = parseRootTokens(html);
/**
 * The reference screen served as if it were the built app: same markup, same stylesheets, minus the
 * mock browser bezel the harness clips away. That is what "the built screen matches the reference"
 * means, so the two shots must come out identical.
 */
const asBuiltApp = (id: string): string =>
  carveScreen(html, findScreen(rows, id)).document.replace(
    '</head>',
    '<style>.mweb-chrome, .dweb-chrome { display: none !important; }</style></head>',
  );

describe.runIf(enabled)('visualCheck', () => {
  let server: Server;
  let origin: string;
  let served = '';
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'komtru-visual-check-'));
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(served);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(outDir, { recursive: true, force: true });
  });

  it('scores a mobile screen against itself as zero and writes all three artefacts', async () => {
    served = asBuiltApp('E1');
    const result = await visualCheck({ screen: 'E1', url: origin, outDir });
    expect(result.ratio).toBe(0);
    expect(result.compared).toEqual({ width: 340, height: 660 });
    for (const file of [result.sideBySide, result.heatMap, result.markdown])
      expect(existsSync(file)).toBe(true);
    expect(result.sideBySide).toMatch(/T-111[/\\]E1\.png$/);
    expect(readFileSync(result.markdown, 'utf8')).toContain('## Deviations');
  }, 120_000);

  it('scores a deliberately altered copy as non-zero', async () => {
    // Repainted in the reference's own risk red: a deviation a reviewer would have to see.
    served = asBuiltApp('E1').replaceAll(
      `--trust-emerald:${tokens.get('--trust-emerald')}`,
      `--trust-emerald:${tokens.get('--risk')}`,
    );
    expect((await visualCheck({ screen: 'E1', url: origin, outDir })).ratio).toBeGreaterThan(0);
  }, 120_000);

  it('scores a desktop screen against itself as zero', async () => {
    served = asBuiltApp('P2-D1');
    const result = await visualCheck({ screen: 'P2-D1', url: origin, outDir });
    expect(result.compared.width).toBe(1040);
    expect(result.ratio).toBe(0);
  }, 120_000);

  it('scores a tablet screen against itself as zero', async () => {
    served = asBuiltApp('P2-T1');
    const result = await visualCheck({ screen: 'P2-T1', url: origin, outDir });
    expect(result.compared.width).toBe(560);
    expect(existsSync(result.sideBySide)).toBe(true);
    expect(result.ratio).toBe(0);
  }, 120_000);

  it('keeps a deviation list written by hand when the screen is checked again', async () => {
    served = asBuiltApp('E1');
    const first = await visualCheck({ screen: 'E1', url: origin, outDir });
    appendFileSync(first.markdown, '- [ ] checked by hand\n');
    const second = await visualCheck({ screen: 'E1', url: origin, outDir });
    expect(readFileSync(second.markdown, 'utf8')).toContain('checked by hand');
  }, 120_000);
});
