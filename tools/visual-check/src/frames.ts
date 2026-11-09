// The six frames the reference's 210 screens are drawn in, and the widths it declares for them.
// No width is typed here: a hand-copied `340` would keep passing long after the reference changed,
// so every number is re-read from the HTML's own CSS and `test/frames.test.ts` fails if a rule goes.
import { parseCssDeclarations } from '@komtru/ui-kit/extract-tokens';

export type Device = 'mobile' | 'tablet' | 'desktop';

export interface Frame {
  /** Every class the frame element carries, so `p2-browser p2-tablet` can outrank `p2-browser`. */
  readonly classes: readonly string[];
  readonly device: Device;
  /** The reference rule that states this frame's width. */
  readonly width: { readonly selector: string; readonly property: 'width' | 'max-width' };
}

/**
 * Most specific first: `matchFrame` takes the first row whose classes are all present, and
 * `p2-browser p2-tablet` is also a `p2-browser`.
 */
export const FRAMES: readonly Frame[] = [
  {
    classes: ['p2-browser', 'p2-tablet'],
    device: 'tablet',
    width: { selector: '#p3-canonical .p2-browser.p2-tablet', property: 'width' },
  },
  {
    classes: ['p2-browser'],
    device: 'desktop',
    width: { selector: '#p3-canonical .p2-browser', property: 'max-width' },
  },
  {
    classes: ['dweb-frame', 'tablet'],
    device: 'tablet',
    width: { selector: '.dweb-frame.tablet', property: 'width' },
  },
  {
    classes: ['dweb-frame', 'desktop'],
    device: 'desktop',
    width: { selector: '.dweb-frame.desktop', property: 'max-width' },
  },
  { classes: ['mweb-frame'], device: 'mobile', width: { selector: '.mweb-frame', property: 'width' } },
  // P1 alone is drawn in the design system's phone bezel rather than the browser frame.
  { classes: ['device', 'phone'], device: 'mobile', width: { selector: '.device.phone', property: 'width' } },
];

export function matchFrame(classAttribute: string): Frame | null {
  const classes = new Set(classAttribute.split(/\s+/).filter(Boolean));
  return FRAMES.find((frame) => frame.classes.every((name) => classes.has(name))) ?? null;
}

/** Every `<style>` element's text, in document order. */
function styleText(html: string): string {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? '').join('\n');
}

interface Rule {
  selectors: string[];
  body: string;
}

/**
 * The style rules at the top level of the sheet. Rules nested in an at-rule are skipped on purpose:
 * the reference carries `@media(max-width:760px){…{width:100%}}` for the very selectors below, and
 * that is a responsive override, not the frame's declared width.
 */
function topLevelRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    const prelude = text.slice(start, i).trim();
    const close = text.indexOf('}', i);
    if (prelude.startsWith('@')) {
      // Step over the whole at-rule block, braces and all.
      let depth = 0;
      let j = i;
      for (; j < text.length; j += 1) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}' && (depth -= 1) === 0) break;
      }
      i = j;
    } else if (close !== -1) {
      rules.push({
        selectors: prelude.split(',').map((selector) => selector.trim()),
        body: text.slice(i + 1, close),
      });
      i = close;
    }
    start = i + 1;
  }
  return rules;
}

/**
 * The pixel width each frame's rule declares. The reference repeats its sheets section by section,
 * so a rule usually appears more than once; disagreeing copies are the realistic way the geometry
 * drifts, and that throws rather than quietly taking the first.
 */
export function frameWidths(html: string): Record<string, number> {
  const rules = topLevelRules(styleText(html));
  const widths: Record<string, number> = {};

  for (const frame of FRAMES) {
    const { selector, property } = frame.width;
    const values = rules
      .filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) => parseCssDeclarations(rule.body).get(property) ?? []);

    // The v2 master also declares `width:min(340px,100%)` and a bare `width:100%` for narrow windows.
    // The first states the same pixel width; the second states no width at all, so it is skipped
    // rather than treated as a disagreement. Anything else still throws.
    const pixels = [
      ...new Set(
        values.flatMap((value) => {
          const text = value.trim();
          const match = /^(\d+)px$/.exec(text) ?? /^min\((\d+)px,\s*100%\)$/.exec(text);
          if (match !== null) return [Number(match[1])];
          if (/^100%(\s*!important)?$/.test(text)) return [];
          throw new Error(`${selector} declares ${property}: ${value}, not a pixel width`);
        }),
      ),
    ];

    const [width] = pixels;
    if (width === undefined) throw new Error(`The reference no longer declares ${property} for ${selector}`);
    if (pixels.length > 1) throw new Error(`${selector} declares ${property} as ${pixels.join(' and ')}`);
    widths[selector] = width;
  }
  return widths;
}
