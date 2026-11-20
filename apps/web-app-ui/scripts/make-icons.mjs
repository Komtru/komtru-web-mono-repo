// Draws the PWA icons in public/icons from the Komtru mark (ui-kit's KomtruMark: three nodes and the
// two links between them) on the brand midnight. Run it after the mark or the brand colours change:
//
//   node apps/web-app-ui/scripts/make-icons.mjs
//
// PNGs are committed, so nothing here runs at build time. Colours come from ui-kit's tokens (build
// ui-kit first).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KOMTRU_TOKENS } from '@komtru/ui-kit';
import { chromium } from '@playwright/test';

const MIDNIGHT = KOMTRU_TOKENS['--komtru-midnight'];
const EMERALD = KOMTRU_TOKENS['--trust-emerald'];
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

/**
 * The mark on a full-bleed midnight square. `scale` is how much of the square the mark's 24-unit
 * box fills: 0.6 for an ordinary icon, 0.5 for a maskable one, whose outer fifth a launcher may crop.
 */
const svg = (scale) => {
  const box = 24 / scale;
  const offset = (box - 24) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-offset} ${-offset} ${box} ${box}">
  <rect x="${-offset}" y="${-offset}" width="${box}" height="${box}" fill="${MIDNIGHT}"/>
  <g fill="none" stroke="${EMERALD}" stroke-width="2" stroke-linecap="round">
    <circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/>
    <path d="M8 11l8-4M8 13l8 4"/>
  </g>
</svg>`;
};

const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 0.6 },
  { file: 'icon-512.png', size: 512, scale: 0.6 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.6 },
];

mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'icon.svg'), svg(0.6));
const browser = await chromium.launch();
try {
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg(icon.scale)}`,
    );
    writeFileSync(resolve(out, icon.file), await page.screenshot({ omitBackground: false }));
    await page.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(`wrote ${ICONS.length + 1} icons to ${out}\n`);
