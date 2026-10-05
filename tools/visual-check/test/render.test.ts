// Gated on KOMTRU_BROWSER_TESTS=1, exactly as scripts/test/playwright-browser.test.ts is: a fresh
// checkout has no browser until `pnpm browsers:install`, and that must not fail everyone's run.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from '@playwright/test';

import { carveScreen } from '../src/reference.ts';
import { chromium, shootBuilt, shootReference } from '../src/render.ts';
import { findScreen, loadScreens, REFERENCE_HTML_PATH } from '../src/screen-index.ts';

const enabled = process.env.KOMTRU_BROWSER_TESTS === '1';
const html = readFileSync(REFERENCE_HTML_PATH, 'utf8');
const rows = loadScreens();
const carve = (id: string) => carveScreen(html, findScreen(rows, id));

describe.runIf(enabled)('screenshots', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('shoots a mobile screen at the width the reference declares', async () => {
    const shot = await shootReference(browser, carve('E1'));
    expect(shot.width).toBe(340);
    expect(shot.height).toBeGreaterThan(400);
  }, 60_000);

  it('leaves the mock browser chrome out of the shot', async () => {
    const shot = await shootReference(browser, carve('E1'));
    const png = PNG.sync.read(shot.png);
    // The chrome strip is #EEF1F6 across its full width; the screen below it is not.
    const topLeft = [png.data[0], png.data[1], png.data[2]];
    expect(topLeft).not.toEqual([0xee, 0xf1, 0xf6]);
  }, 60_000);

  it('shoots desktop and tablet screens at their declared widths', async () => {
    expect((await shootReference(browser, carve('P2-D1'))).width).toBe(1040);
    expect((await shootReference(browser, carve('P2-T1'))).width).toBe(560);
  }, 60_000);

  it('renders the reference in the real brand faces', async () => {
    const withFonts = await shootReference(browser, carve('E1'));
    const without = await shootReference(browser, carve('E1'), { injectFonts: false });
    expect(withFonts.png.equals(without.png)).toBe(false);
  }, 60_000);

  it('is deterministic across runs', async () => {
    const first = await shootReference(browser, carve('E1'));
    const second = await shootReference(browser, carve('E1'));
    expect(first.png.equals(second.png)).toBe(true);
  }, 60_000);

  it('shoots a built page at exactly the size it is given', async () => {
    const shot = await shootBuilt(browser, `data:text/html,${encodeURIComponent('<p>hi</p>')}`, {
      width: 340,
      height: 500,
    });
    expect([shot.width, shot.height]).toEqual([340, 500]);
  }, 60_000);

  it('says which URL it could not reach', async () => {
    await expect(
      shootBuilt(browser, 'http://127.0.0.1:1/nothing', { width: 10, height: 10 }),
    ).rejects.toThrow(/127\.0\.0\.1:1/);
  }, 60_000);
});
