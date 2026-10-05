import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FRAMES, frameWidths, matchFrame } from '../src/frames.ts';
import { REFERENCE_HTML_PATH } from '../src/screen-index.ts';

const html = readFileSync(REFERENCE_HTML_PATH, 'utf8');

describe('the reference frames', () => {
  it('reads every width out of the reference CSS', () => {
    expect(frameWidths(html)).toEqual({
      '.mweb-frame': 340,
      '.device.phone': 230,
      '.dweb-frame.tablet': 560,
      '.dweb-frame.desktop': 1040,
      '#p3-canonical .p2-browser.p2-tablet': 560,
      '#p3-canonical .p2-browser': 1040,
    });
  });

  it('agrees on the three device widths', () => {
    const widths = frameWidths(html);
    for (const frame of FRAMES) expect(widths[frame.width.selector]).toBeGreaterThan(0);
    expect(widths['.dweb-frame.tablet']).toBe(widths['#p3-canonical .p2-browser.p2-tablet']);
    expect(widths['.dweb-frame.desktop']).toBe(widths['#p3-canonical .p2-browser']);
  });

  it('fails loudly when the reference stops declaring one', () => {
    expect(() => frameWidths(html.replaceAll('.mweb-frame{width:340px;', '.mweb-frame{'))).toThrow(
      /\.mweb-frame/,
    );
  });

  it('fails loudly when two copies of a rule disagree', () => {
    expect(() =>
      frameWidths(html.replace('.dweb-frame.tablet{width:560px;}', '.dweb-frame.tablet{width:561px;}')),
    ).toThrow(/\.dweb-frame\.tablet/);
  });

  it('prefers the tablet variant over the bare browser frame', () => {
    expect(matchFrame('p2-browser p2-tablet')?.device).toBe('tablet');
    expect(matchFrame('p2-browser')?.device).toBe('desktop');
    expect(matchFrame('dweb-frame tablet')?.device).toBe('tablet');
    expect(matchFrame('dweb-frame desktop')?.device).toBe('desktop');
    expect(matchFrame('device phone')?.device).toBe('mobile');
    expect(matchFrame('mweb-frame')?.device).toBe('mobile');
  });

  it('matches nothing it does not know', () => {
    expect(matchFrame('screen-unit')).toBeNull();
  });
});
