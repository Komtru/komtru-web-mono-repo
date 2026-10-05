import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { composeSideBySide, diffPngs } from '../src/diff.ts';

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const EMERALD: Rgb = [21, 151, 104];
const RISK: Rgb = [192, 57, 46];

function solid(width: number, height: number, [r, g, b]: Rgb): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([r, g, b, 255], i);
  return PNG.sync.write(png);
}

function withPixel(source: Buffer, x: number, y: number, [r, g, b]: Rgb): Buffer {
  const png = PNG.sync.read(source);
  png.data.set([r, g, b, 255], (y * png.width + x) * 4);
  return PNG.sync.write(png);
}

const pixelAt = (png: PNG, x: number, y: number): Rgb => {
  const at = (y * png.width + x) * 4;
  return [png.data[at]!, png.data[at + 1]!, png.data[at + 2]!];
};

describe('diffPngs', () => {
  it('scores an identical pair as zero', () => {
    const png = solid(20, 10, EMERALD);
    expect(diffPngs(png, png)).toMatchObject({ changed: 0, ratio: 0, total: 200, width: 20, height: 10 });
  });

  it('scores a wholly different pair as one', () => {
    expect(diffPngs(solid(20, 10, [0, 0, 0]), solid(20, 10, WHITE)).ratio).toBe(1);
  });

  it('scores a single changed pixel', () => {
    const before = solid(20, 10, WHITE);
    const { changed, ratio } = diffPngs(before, withPixel(before, 3, 4, RISK));
    expect(changed).toBe(1);
    expect(ratio).toBeCloseTo(1 / 200, 6);
  });

  it('marks the changed pixel in the heat map and leaves the rest cool', () => {
    const before = solid(20, 10, WHITE);
    const heat = PNG.sync.read(diffPngs(before, withPixel(before, 3, 4, RISK)).heatMap);
    expect(pixelAt(heat, 3, 4)).not.toEqual(pixelAt(heat, 0, 0));
  });

  it('names both sizes when they disagree', () => {
    expect(() => diffPngs(solid(20, 10, WHITE), solid(21, 10, WHITE))).toThrow(/20×10[\s\S]*21×10/);
  });
});

describe('composeSideBySide', () => {
  it('lays the panels out left to right, tallest sets the height', () => {
    const composite = PNG.sync.read(
      composeSideBySide([solid(20, 10, RISK), solid(30, 12, EMERALD)], { gap: 4 }),
    );
    expect([composite.width, composite.height]).toEqual([54, 12]);
    expect(pixelAt(composite, 0, 0)).toEqual(RISK);
    expect(pixelAt(composite, 24, 0)).toEqual(EMERALD);
  });

  it('separates the panels with a visible rule', () => {
    const composite = PNG.sync.read(composeSideBySide([solid(4, 4, WHITE), solid(4, 4, WHITE)], { gap: 2 }));
    expect(pixelAt(composite, 5, 0)).not.toEqual(WHITE);
  });

  it('refuses an empty strip', () => {
    expect(() => composeSideBySide([])).toThrow(/no panels/i);
  });
});
