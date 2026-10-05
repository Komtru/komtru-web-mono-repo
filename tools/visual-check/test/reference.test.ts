import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { rootBlocks } from '@komtru/ui-kit/extract-tokens';

import { carveScreen, openElements, styleBlocks } from '../src/reference.ts';
import { findScreen, loadScreens, REFERENCE_HTML_PATH } from '../src/screen-index.ts';

const html = readFileSync(REFERENCE_HTML_PATH, 'utf8');
const rows = loadScreens();
const carve = (id: string, line?: number) => carveScreen(html, findScreen(rows, id, line));

describe('openElements', () => {
  it('returns the chain of elements open at an offset', () => {
    const doc = '<html><body><div class="a"><p>x</p><span id="b">|</span></div></body></html>';
    expect(openElements(doc, doc.indexOf('|')).map((element) => element.tag)).toEqual([
      'html',
      'body',
      'div',
      'span',
    ]);
  });

  it('does not treat void or self-closed elements as open', () => {
    const doc = '<div><br><img src="x"><svg><circle r="1"/></svg>|</div>';
    expect(openElements(doc, doc.indexOf('|')).map((element) => element.tag)).toEqual(['div']);
  });

  it('ignores markup inside comments and raw-text elements', () => {
    const doc = '<div><!-- <section> --><style>a{content:"<b>"}</style>|</div>';
    expect(openElements(doc, doc.indexOf('|')).map((element) => element.tag)).toEqual(['div']);
  });

  it('ends an attribute at its own quote, exactly as a browser does', () => {
    const doc = '<div><button onclick="x=\'<svg a=\\"1\\">\'"></button>|</div>';
    expect(openElements(doc, doc.indexOf('|')).map((element) => element.tag)).toEqual(['div']);
  });
});

describe('carveScreen', () => {
  it('keeps every stylesheet, including all five :root blocks', () => {
    const { document } = carve('E1');
    expect(styleBlocks(document)).toHaveLength(styleBlocks(html).length + 1); // + the harness sheet
    expect(rootBlocks(document)).toHaveLength(5);
  });

  it('carves the frame and drops the gallery caption', () => {
    const { document, device, width } = carve('E1');
    expect(device).toBe('mobile');
    expect(width).toBe(340);
    expect(document).toContain('Trade with strangers, protected.');
    expect(document).not.toContain('<div class="screen-num">');
    expect(document).not.toContain('Four screens, phone-number-first');
  });

  it('replays the ancestor chain so section-scoped CSS still applies', () => {
    const { document } = carve('P3-D1');
    expect(document).toContain('id="p3-canonical"');
    expect(document).toContain('data-komtru-vc="ancestor"');
  });

  it('marks the frame so the harness sheet can strip its bezel', () => {
    expect(carve('E1').document).toContain('data-komtru-vc="frame"');
  });

  it('carves the one screen that uses the device bezel', () => {
    expect(carve('P1')).toMatchObject({ device: 'mobile', width: 230 });
  });

  it('carves a desktop and a tablet screen at the declared widths', () => {
    expect(carve('P2-D1').width).toBe(1040);
    expect(carve('P2-T1').width).toBe(560);
    expect(carve('P3-T1').device).toBe('tablet');
  });

  it('carves both variants of the id the reference draws twice', () => {
    expect(carve('TO-PA10', 8309).document).not.toBe(carve('TO-PA10', 8336).document);
  });

  it('carves all 210 screens into balanced documents', () => {
    for (const row of rows) {
      const { document, width, device } = carveScreen(html, row);
      expect(width, `${row.id}`).toBeGreaterThan(0);
      expect(device, `${row.id}`).toBeTruthy();
      // The carve is parsed back with the same scanner: nothing it replayed may be left open.
      expect(openElements(document, document.length), `${row.id}`).toEqual([]);
    }
  });
});
