// Throwaway driver for the F-018 visual check (not committed): like run.ts, but walks the built wizard to each stage.
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { composeSideBySide, diffPngs } from './diff.ts';
import { carveScreen } from './reference.ts';
import { mergeStub, renderStub } from './report.ts';
import { chromium, shootReference } from './render.ts';
import { fontStylesheet } from './fonts.ts';
import { findScreen, loadScreens, REFERENCE_HTML_PATH, ticketId } from './screen-index.ts';
import { UI_REVIEW_DIR } from './run.ts';

const BASE = 'http://localhost:3118';
const secret = readFileSync(process.env.SECRET_FILE as string, 'utf8').trim();
const b64 = (b: Buffer) => b.toString('base64url');
const body = b64(Buffer.from(JSON.stringify({ s: 'CONSUMER', e: Math.floor(Date.now() / 1000) + 86400 })));
const cookie = `v1.${body}.${b64(createHmac('sha256', secret).update(`v1.${body}`).digest())}`;

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const press = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function about(page: Page) {
  await page.goto(`${BASE}/trade/new`);
  await page.getByLabel(/Who's the seller/).fill('@techedge');
  await page.getByLabel(/Who's the seller/).blur();
  await page.getByText(/Profile found/).waitFor();
  await page.getByLabel('What are you buying?').fill('iPhone 13 Pro');
  await page.getByLabel('Agreed price').fill('452,000');
  await page.getByText(/You pay/).waitFor();
}
async function toStage(page: Page, n: number) {
  await about(page);
  const steps: [string, string][] = [
    ['Continue', 'How should this item get to you?'],
    ['Continue', 'Trade terms'],
    ['Review', 'Send Trade proposal'],
  ];
  for (let i = 0; i < n; i++) {
    await press(page, steps[i]![0]);
    if (i === 0) await page.getByRole('radio', { name: /Home/ }).waitFor();
    await page.getByText(steps[i]![1], { exact: false }).first().waitFor();
  }
}
async function item(page: Page, path: string) {
  await page.route('https://upload.test/**', (route) => route.fulfill({ status: 200, body: '{}' }));
  await page.goto(`${BASE}${path}`);
  await page.getByLabel('Brand', { exact: true }).fill('Apple');
  await page.getByLabel('Model', { exact: true }).fill('iPhone 13 Pro');
  await page.getByLabel('Serial / IMEI (optional)').fill('256GB · Sierra Blue');
  await page.getByRole('radio', { name: 'Brand new' }).check({ force: true });
  await page
    .locator('input[type="file"]')
    .setInputFiles([
      ...[1, 2, 3].map((n) => ({ name: `p${n}.png`, mimeType: 'image/png', buffer: png })),
      { name: 'v.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') },
    ]);
  await page.waitForTimeout(1500);
}

const screens: Record<string, { url: string; drive: (page: Page) => Promise<void>; content?: string }> = {
  'CT-B1': { url: '/trade/new', drive: about },
  'CT-B2': { url: '/trade/new', drive: (p) => toStage(p, 1) },
  'CT-B2P': {
    url: '/trade/new',
    drive: async (p) => {
      await toStage(p, 1);
      await p.getByRole('radio', { name: /^Park/ }).check({ force: true });
      await p.getByLabel('Phone').fill('0803 221 4471');
      await p.getByRole('radio', { name: /Jos Central/ }).check({ force: true });
    },
  },
  'CT-B3': { url: '/trade/new', drive: (p) => toStage(p, 2) },
  'CT-B4': { url: '/trade/new', drive: (p) => toStage(p, 3) },
  'CT-B5': {
    url: '/trade/new',
    drive: async (p) => {
      await toStage(p, 3);
      await press(p, 'Send Trade proposal');
      await p.getByText(/^Sent to/).waitFor();
    },
  },
  'CT-B6': {
    url: `/trade/${id(1)}`,
    drive: async (p) => {
      await p.goto(`${BASE}/trade/${id(1)}`);
      await p.getByText('Complete the details').waitFor();
    },
  },
  'CT-B7': {
    url: `/trade/${id(1)}/complete`,
    drive: async (p) => {
      await p.goto(`${BASE}/trade/${id(1)}/complete`);
      await p.getByLabel('Brand', { exact: true }).waitFor();
    },
  },
  'CT-B8': {
    url: `/trade/${id(1)}/complete`,
    drive: async (p) => {
      await item(p, `/trade/${id(1)}/complete`);
      await press(p, 'Continue');
      await p.getByLabel('Delivery partner').waitFor();
    },
  },
  'CT-B8P': {
    url: `/trade/${id(2)}/complete`,
    drive: async (p) => {
      await item(p, `/trade/${id(2)}/complete`);
      await press(p, 'Continue');
      await p.getByText(/collect at a Park/).waitFor();
    },
  },
  'CT-B9': {
    url: `/trade/${id(1)}/complete`,
    drive: async (p) => {
      await item(p, `/trade/${id(1)}/complete`);
      await press(p, 'Continue');
      await p.getByLabel('Delivery partner').fill('SwiftDrop');
      await p.getByLabel(/Delivery charge/).fill('2,500');
      await p.getByRole('radio', { name: '5–7 days' }).check({ force: true });
      await p.getByRole('radio', { name: /Home/ }).waitFor();
      await press(p, 'Review');
      await p.getByText('Confirm & send to buyer').waitFor();
      await p.getByText('Total due on funding').waitFor();
    },
  },
  'CT-B10': {
    url: `/trade/${id(3)}`,
    drive: async (p) => {
      await p.goto(`${BASE}/trade/${id(3)}`);
      await p.getByText('Total due on funding').waitFor();
    },
  },
};

const only = process.argv.slice(2);
const html = readFileSync(REFERENCE_HTML_PATH, 'utf8');
const browser = await chromium.launch();
try {
  for (const [screen, spec] of Object.entries(screens)) {
    if (only.length > 0 && !only.includes(screen)) continue;
    const row = findScreen(loadScreens(), screen);
    const carved = carveScreen(html, row);
    const ref = await shootReference(browser, carved);
    const context = await browser.newContext({
      viewport: { width: ref.width, height: ref.height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    await context.addCookies([{ name: 'komtru_session', value: cookie, url: BASE }]);
    const page = await context.newPage();
    try {
      await spec.drive(page);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      await page.evaluate(async () => {
        await Promise.all([...document.fonts].map((f) => f.load()));
        await document.fonts.ready;
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      const box = await page.locator('main').first().boundingBox();
      if (box === null) throw new Error('no main');
      const needed = Math.ceil(box.y) + ref.height;
      if (needed > ref.height) await page.setViewportSize({ width: ref.width, height: needed });
      await page.waitForTimeout(300);
      const y = Math.max(0, Math.floor((await page.locator('main').first().boundingBox())!.y));
      const built = await page.screenshot({
        fullPage: true,
        clip: { x: 0, y, width: ref.width, height: ref.height },
      });
      const diff = diffPngs(ref.png, built, { threshold: 0.1 });
      const dir = join(UI_REVIEW_DIR, ticketId(row));
      mkdirSync(dir, { recursive: true });
      const files = { sideBySide: `${row.id}.png`, heatMap: `${row.id}.diff.png` };
      writeFileSync(join(dir, files.sideBySide), composeSideBySide([ref.png, built, diff.heatMap]));
      writeFileSync(join(dir, files.heatMap), diff.heatMap);
      const md = join(dir, `${row.id}.md`);
      const fresh = renderStub({
        row,
        url: `${BASE}${spec.url}`.replace(BASE, 'http://localhost:3118'),
        device: carved.device,
        frameWidth: carved.width,
        compared: { width: diff.width, height: diff.height },
        diff,
        files,
      });
      let existing = '';
      try {
        existing = readFileSync(md, 'utf8');
      } catch {}
      writeFileSync(md, mergeStub(existing, fresh));
      console.log(screen, (diff.ratio * 100).toFixed(2) + '%', diff.changed, diff.total);
    } catch (e) {
      console.log(screen, 'FAILED', (e as Error).message.split('\n')[0]);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
