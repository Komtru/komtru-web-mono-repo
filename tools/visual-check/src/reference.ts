// Carves one screen out of the 9,181-line reference into a standalone document.
//
// The alternative — render the whole file and crop — was rejected because the gallery's own layout
// decides the screen's width: `.screen-row` is a horizontally scrolling flexbox and `.screen-unit`
// carries inline widths like `calc(50% - 9px)`, so a crop is the width of the gallery, not of the
// frame. The carve keeps the three things the screen actually depends on: every `<style>` element
// (the later sheets override the earlier ones), the chain of ancestors (`#p3-canonical` scopes
// eighteen rules that set Part 3's geometry), and the frame element itself — but not the
// `.screen-num` caption, which is gallery furniture rather than part of the screen.
import { matchFrame, type Device, type Frame, frameWidths } from './frames.ts';
import type { ScreenRow } from './screen-index.ts';

/**
 * The carved page is rendered at the gallery's own width, not at the frame's. The reference carries
 * `@media(max-width:900px)` rules from the design system it was assembled from; at a 560px viewport
 * they fire and redraw a tablet screen as something the reference never shows. Pinning the frame's
 * width in CSS and leaving the viewport wide reproduces exactly what a reviewer sees in the file.
 */
export const REFERENCE_VIEWPORT = { width: 1280, height: 900 } as const;

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements whose content is text, not markup: a `<` inside them opens nothing. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

export interface OpenElement {
  tag: string;
  /** The open tag verbatim, `<` to `>`. */
  open: string;
  /** Offset of the `<`. */
  start: number;
  /** Offset just past the `>`. */
  end: number;
  classes: string[];
  id: string | null;
}

interface CloseToken {
  kind: 'close';
  tag: string;
  start: number;
  end: number;
}

type Token = ({ kind: 'open'; selfClosed: boolean } & OpenElement) | CloseToken;

const attribute = (open: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(open)?.[1] ?? null;

/**
 * Tokenises the reference the way a browser would, which is all this needs to do: one generated
 * document, no scripts that write markup. The two places a naive regex gets it wrong are both here —
 * an attribute value ends at its own quote (the reference has an `onclick` holding escaped markup,
 * and the browser mis-parses it in exactly this way too), and `<style>` content is not markup.
 */
function* tokenise(html: string): Generator<Token> {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) return;

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const close = html.indexOf('>', lt);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const close = html.indexOf('>', lt);
      if (close === -1) return;
      yield {
        kind: 'close',
        tag: html
          .slice(lt + 2, close)
          .trim()
          .toLowerCase(),
        start: lt,
        end: close + 1,
      };
      i = close + 1;
      continue;
    }

    const name = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 80));
    if (name === null) {
      i = lt + 1;
      continue;
    }

    let quote: string | null = null;
    let j = lt + name[0].length;
    for (; j < html.length; j += 1) {
      const char = html[j];
      if (quote !== null) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }

    const end = Math.min(j + 1, html.length);
    const open = html.slice(lt, end);
    const tag = (name[1] ?? '').toLowerCase();
    const selfClosed = open.endsWith('/>') || VOID_ELEMENTS.has(tag);
    yield {
      kind: 'open',
      tag,
      open,
      start: lt,
      end,
      selfClosed,
      classes: (attribute(open, 'class') ?? '').split(/\s+/).filter(Boolean),
      id: attribute(open, 'id'),
    };

    i = end;
    if (!selfClosed && RAW_TEXT_ELEMENTS.has(tag)) {
      const closing = new RegExp(`</${tag}[\\s>]`, 'gi');
      closing.lastIndex = i;
      i = closing.exec(html)?.index ?? html.length;
    }
  }
}

/** The elements still open at `index`, outermost first. */
export function openElements(html: string, index: number): OpenElement[] {
  const stack: OpenElement[] = [];
  for (const token of tokenise(html)) {
    if (token.end > index) break;
    if (token.kind === 'close') {
      const at = stack.findLastIndex((element) => element.tag === token.tag);
      if (at !== -1) stack.length = at;
    } else if (!token.selfClosed) {
      stack.push(token);
    }
  }
  return stack;
}

const closeAll = (open: readonly string[]): string =>
  [...open]
    .reverse()
    .map((tag) => `</${tag}>`)
    .join('');

/**
 * The element's markup, closing tag included. The reference is hand-assembled and not every element
 * in it is closed — TO-PA9's frame runs straight into the next section — so this recovers the way a
 * browser does: a closing tag for something further out ends the element, and whatever is still open
 * at `limit` is closed explicitly, so the carve is always a balanced document.
 */
function extractElement(html: string, element: OpenElement, limit: number): string {
  const open: string[] = [];
  for (const token of tokenise(html.slice(element.start, limit))) {
    if (token.kind === 'open') {
      if (!token.selfClosed) open.push(token.tag);
      continue;
    }
    const at = open.lastIndexOf(token.tag);
    if (at === -1) return html.slice(element.start, element.start + token.start) + closeAll(open);
    open.length = at;
    if (open.length === 0) return html.slice(element.start, element.start + token.end);
  }
  return html.slice(element.start, limit) + closeAll(open);
}

/** Where a screen's markup can no longer run: the next screen, divider or section starts there. */
function screenLimit(html: string, from: number): number {
  const starts = [
    '<div class="screen-num">',
    '<div class="divider-major">',
    '<section',
    '<div class="part-heading"',
  ]
    .map((marker) => html.indexOf(marker, from))
    .filter((index) => index !== -1);
  return starts.length === 0 ? html.length : Math.min(...starts);
}

/** Every `<style>` element, tags and all, in document order. */
export function styleBlocks(html: string): string[] {
  return [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map((match) => match[0]);
}

const withMarker = (open: string, role: 'ancestor' | 'frame'): string =>
  `${open.slice(0, -1).replace(/\/$/, '').trimEnd()} data-komtru-vc="${role}">`;

/**
 * Flattens the replayed ancestors so only the frame lays anything out, and strips the frame's own
 * device chrome — its border, radius, shadow and bezel padding are a drawing of a browser, not part
 * of the screen. Dropping the 1px border is also what makes the shot exactly the declared width
 * rather than two pixels short of it.
 */
const harnessStylesheet = (width: number): string => `<style id="komtru-visual-check">
html, body { margin: 0; padding: 0; background: var(--surface-primary); }
[data-komtru-vc='ancestor'] {
  display: block !important; width: auto !important; max-width: none !important; min-width: 0 !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; gap: 0 !important;
  background: none !important; box-shadow: none !important; overflow: visible !important;
  transform: none !important;
}
[data-komtru-vc='frame'] {
  width: ${width}px !important; max-width: ${width}px !important; min-width: 0 !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important;
  box-shadow: none !important;
}
</style>`;

export interface CarvedScreen {
  row: ScreenRow;
  /** A complete HTML document showing just this screen. */
  document: string;
  device: Device;
  /** The width the reference declares for this frame, in CSS pixels. */
  width: number;
  frame: Frame;
}

/** `frameWidths` re-parses every sheet; carving all 210 screens would otherwise do it 210 times. */
let widthCache: { html: string; widths: Record<string, number> } | null = null;

function widthOf(html: string, frame: Frame): number {
  if (widthCache === null || widthCache.html !== html) widthCache = { html, widths: frameWidths(html) };
  const width = widthCache.widths[frame.width.selector];
  if (width === undefined) throw new Error(`No declared width for ${frame.width.selector}`);
  return width;
}

function offsetOfLine(html: string, line: number): number {
  let offset = 0;
  for (let seen = 1; seen < line; seen += 1) {
    const next = html.indexOf('\n', offset);
    if (next === -1) throw new Error(`The reference has fewer than ${line} lines`);
    offset = next + 1;
  }
  return offset;
}

export function carveScreen(html: string, row: ScreenRow): CarvedScreen {
  const lineStart = offsetOfLine(html, row.line);
  const caption = html.indexOf('<div class="screen-num">', lineStart);
  const lineEnd = html.indexOf('\n', lineStart);
  if (caption === -1 || (lineEnd !== -1 && caption > lineEnd)) {
    throw new Error(`No screen-num header on line ${row.line} — SCREEN_INDEX.md is stale for ${row.id}`);
  }

  const ancestors = openElements(html, caption);
  const limit = screenLimit(html, caption + 1);

  let frame: Frame | null = null;
  let element: OpenElement | null = null;
  for (const token of tokenise(html.slice(caption, limit))) {
    if (token.kind !== 'open') continue;
    const matched = matchFrame(token.classes.join(' '));
    if (matched !== null) {
      frame = matched;
      element = { ...token, start: token.start + caption, end: token.end + caption };
      break;
    }
  }
  if (frame === null || element === null) {
    throw new Error(`${row.id} at line ${row.line} is not drawn in a frame this harness knows`);
  }

  const width = widthOf(html, frame);
  const markup =
    withMarker(element.open, 'frame') + extractElement(html, element, limit).slice(element.open.length);
  // `html`, `head` and `body` are replayed as the carved document's own; everything between them
  // and the frame is replayed verbatim, because CSS below is scoped to it.
  const chain = ancestors.filter((open) => !['html', 'head', 'body'].includes(open.tag));

  const document = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    `<title>${row.id} — ${row.screen}</title>`,
    ...styleBlocks(html),
    harnessStylesheet(width),
    '</head>',
    '<body>',
    ...chain.map((open) => withMarker(open.open, 'ancestor')),
    markup,
    ...chain.map((open) => `</${open.tag}>`).reverse(),
    '</body>',
    '</html>',
    '',
  ].join('\n');

  return { row, document, device: frame.device, width, frame };
}
