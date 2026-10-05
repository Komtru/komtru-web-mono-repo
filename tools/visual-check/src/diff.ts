// Scoring and presenting the comparison. Everything here is a pure function over PNG buffers, so
// it is tested on images the test generates rather than on fixtures nobody can re-derive.
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface DiffResult {
  width: number;
  height: number;
  /** Pixels pixelmatch flagged. */
  changed: number;
  total: number;
  /** `changed / total`, which is what the markdown stub reports. */
  ratio: number;
  /** The flagged pixels in red over a faded reference: the heat map. */
  heatMap: Buffer;
}

export interface DiffOptions {
  /** pixelmatch's colour-distance tolerance; its own default. */
  threshold?: number;
}

const size = (png: PNG): string => `${png.width}×${png.height}`;

export function diffPngs(reference: Buffer, built: Buffer, options: DiffOptions = {}): DiffResult {
  const left = PNG.sync.read(reference);
  const right = PNG.sync.read(built);

  // pixelmatch throws "Image sizes do not match" with no numbers in it. The sizes are the whole
  // diagnosis — one side laid out at a width the other did not — so say them.
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`Cannot diff a ${size(left)} reference against a ${size(right)} screenshot`);
  }

  const { width, height } = left;
  const heat = new PNG({ width, height });
  const changed = pixelmatch(left.data, right.data, heat.data, width, height, {
    threshold: options.threshold ?? 0.1,
    // Antialiasing differs between a 340px-wide box inside a 1280px page and the same box as the
    // whole page; those pixels are a rendering artefact, not a design deviation.
    includeAA: false,
    // …and so they must not be painted either. pixelmatch's default marks them yellow, which on a
    // text-heavy screen is more highlighted area than the red it counts — a reviewer would spend
    // the review chasing pixels the score deliberately ignores.
    aaColor: FADED,
  });

  const total = width * height;
  return {
    width,
    height,
    changed,
    total,
    ratio: total === 0 ? 0 : changed / total,
    heatMap: PNG.sync.write(heat),
  };
}

export interface ComposeOptions {
  /** Width of the rule between panels. */
  gap?: number;
}

/** The grey pixelmatch fades the unchanged reference to, so an ignored pixel stays unhighlighted. */
const FADED: [number, number, number] = [255, 255, 255];

// The reference's own `--trust-indigo`, so the separator reads as part of the design system rather
// than as something in the screenshot.
const RULE = new Uint8Array([0x45, 0x52, 0xd6, 255]);

/** The panels left to right on one canvas, top-aligned, separated by an indigo rule. */
export function composeSideBySide(panels: readonly Buffer[], options: ComposeOptions = {}): Buffer {
  if (panels.length === 0) throw new Error('Cannot compose a strip with no panels');

  const gap = options.gap ?? 8;
  const images = panels.map((panel) => PNG.sync.read(panel));
  const width = images.reduce((total, image) => total + image.width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map((image) => image.height));

  const strip = new PNG({ width, height });
  for (let i = 0; i < strip.data.length; i += 4) strip.data.set(RULE, i);

  let x = 0;
  for (const image of images) {
    for (let row = 0; row < image.height; row += 1) {
      const from = row * image.width * 4;
      image.data.copy(strip.data, (row * width + x) * 4, from, from + image.width * 4);
    }
    x += image.width + gap;
  }
  return PNG.sync.write(strip);
}
