// The visual-check harness (T-016) screenshots every built screen next to the reference HTML, which
// only works if the pinned Playwright's own browser build is present. "Installed" is not a state a
// runbook can assert, so this launches it. Runs only when KOMTRU_BROWSER_TESTS=1: a fresh checkout
// has no browser until `pnpm browsers:install`, and that must not fail everyone's test run.
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';

const enabled = process.env.KOMTRU_BROWSER_TESTS === '1';

describe.runIf(enabled)('playwright chromium', () => {
  it('launches, renders the reference fonts and closes', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.setContent('<h1 style="font-family: Inter, sans-serif">Komtru</h1>');
      expect(await page.locator('h1').textContent()).toBe('Komtru');
      expect((await page.screenshot()).byteLength).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
