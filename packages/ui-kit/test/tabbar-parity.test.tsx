/**
 * `TabBar` against v2's `.komtru-mobile-nav` (T-222). T-110 built it from v1's `.scr-tabbar`; the
 * v2 master draws a different bar — an indigo-soft pill behind the current item, 20px icons, 9.5px
 * labels, a blurred translucent surface and a lifted shadow — so it gets its own suite and reads
 * the v2 file, not the v1 file `shells-parity.test.tsx` reads.
 *
 * The rules come from `<style id="komtru-mobile-ia-v2">`, with `komtru-layout-reconcile` (about
 * l.11957) laid over them: it makes the grid five columns and the label 9.5px, and it wins.
 */
import { readFileSync } from 'node:fs';
import { TabBar } from '../src/index.js';
import { type Additions, type Deviations, type ParityRow, describeParity } from './parity-harness.js';
import { declarationsAtWidth } from './responsive-css.js';

const V2_HTML = new URL('../../../docs/design-reference/Komtru — UI Living Master v2.html', import.meta.url);
const html = readFileSync(V2_HTML, 'utf8');

/** The rules, then the block that later makes the bar five columns and the label 9.5px. */
const STYLE = ['komtru-mobile-ia-v2', 'komtru-layout-reconcile'] as const;
/** A phone wider than the reference's `max-width:380px` squeeze (5px padding, 2px gap, 9px label). */
const PHONE = 390;

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const BAR = (
  <TabBar
    items={[
      { label: 'Home', icon: ICON, href: '/home', current: true },
      { label: 'Trades', icon: ICON, href: '/trades' },
    ]}
  />
);

const DEVIATIONS: Deviations = {
  'kmn-nav': {
    'grid-template-columns':
      'v2 hard-codes four columns here and a later block makes it five. A `TabBar` takes any number ' +
      'of items, so the columns are `grid-flow-col auto-cols-fr` — equal `minmax(0,1fr)` tracks, one ' +
      'per item — which is what both of v2’s counts resolve to.',
  },
  'kmn-item-active': {
    transition: 'Inherited from the base rule — see kmn-item. Tailwind’s longhands carry it instead.',
  },
  'kmn-item': {
    transition:
      'Written as the `transition` shorthand in the reference and as Tailwind’s three longhands ' +
      'here, which the diff cannot compare literally. The properties, duration and easing match.',
  },
};

const ADDITIONS: Additions = {
  // `auto-cols-fr` is the half of the column deviation above that is not a template.
  'kmn-nav': ['grid-auto-columns', 'grid-auto-flow'],
  // The reference's item is an `<a>`, so it gets these for free; a `<button>` item does not.
  'kmn-item-active': ['transition-property', 'transition-duration', 'transition-timing-function'],
  'kmn-item': [
    'background-color',
    'transition-property',
    'transition-duration',
    'transition-timing-function',
  ],
  // `stroke-current` is how a caller's icon takes the item's colour; v2's svg sets
  // `stroke="currentColor"` as an attribute on every glyph, which a passed-in icon does not carry.
  'kmn-icon': ['stroke'],
};

const ROWS: ParityRow[] = [
  { id: 'kmn-nav', selector: '.komtru-mobile-nav', styleId: STYLE, element: BAR, node: 0 },
  { id: 'kmn-item', selector: '.komtru-mobile-nav .kmn-item', styleId: STYLE, element: BAR, node: 3 },
  {
    id: 'kmn-item-active',
    selector: '.komtru-mobile-nav .kmn-item.is-active',
    extends: ['.komtru-mobile-nav .kmn-item'],
    styleId: STYLE,
    element: BAR,
    node: 1,
  },
  { id: 'kmn-icon', selector: '.komtru-mobile-nav .kmn-item svg', styleId: STYLE, element: BAR, node: 2 },
];

describeParity({
  html,
  rows: ROWS,
  deviations: DEVIATIONS,
  additions: ADDITIONS,
  declarations: declarationsAtWidth,
  defaultWidth: PHONE,
});
