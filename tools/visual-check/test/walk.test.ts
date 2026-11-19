// The walk runner against a real page, so a click that finds nothing is seen to fail. Browser-gated, like the
// other suites that launch Chromium.
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withBrowser } from '../src/render.ts';
import { arrangeFor, runSteps, type Walkthrough } from '../src/walk.ts';

const enabled = process.env.KOMTRU_BROWSER_TESTS === '1';

const FLOW = `<!doctype html><html><body>
  <button onclick="document.getElementById('step2').hidden=false">Start a trade</button>
  <section id="step2" hidden><input aria-label="Item name"><a href="#done">Continue to review</a></section>
  <h1 id="done">Review</h1>
</body></html>`;

describe.runIf(enabled)('runSteps', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(FLOW);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reaches a screen several steps into a flow, and the screen is then on the page', async () => {
    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.goto(origin);
      await runSteps(
        page,
        [
          { click: 'role=button[name="Start a trade"]' },
          { fill: 'role=textbox[name="Item name"]', value: 'Canon body' },
          { click: 'text=Continue to review' },
          { waitFor: 'role=heading[name="Review"]' },
        ],
        'TEST-1',
      );
      expect(await page.locator('#done').isVisible()).toBe(true);
      await page.close();
    });
  }, 60_000);

  it('fails at the step that found nothing, and names it', async () => {
    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.goto(origin);
      await expect(runSteps(page, [{ click: 'text=No such control' }], 'TEST-2')).rejects.toThrow(
        /TEST-2, step 1: could not click text=No such control/,
      );
      await page.close();
    });
  }, 60_000);

  it('refuses a page the app redirected to sign-in, so a login form is never shot as a screen', async () => {
    const walk: Walkthrough = { screen: 'TEST-3', persona: 'buyer', scenario: 'no-trades', path: '/home' };
    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.goto(`${origin}login`).catch(() => undefined);
      await expect(arrangeFor(walk)(page)).rejects.toThrow(/did not accept the seed/);
      await page.close();
    });
  }, 60_000);
});
