/**
 * Every shell is checked against the rules the reference HTML declares for it, resolved at the
 * width the reference draws that screen at — a shell's rule is conditional where a primitive's is
 * not, and comparing `.dweb-content` against the tablet cascade would pass for the wrong reason.
 *
 * The runner, and what `DEVIATIONS`/`ADDITIONS` mean, live in `parity.tsx`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ConsoleShell,
  DesktopShell,
  LogoBar,
  MobileShell,
  PublicShell,
  SideNav,
  TabBar,
  TopBar,
} from '../src/index.js';
import { REFERENCE_HTML } from '../scripts/extract-tokens.js';
import { type ParityRow, describeParity } from './parity.js';
import { referenceRule } from './reference-css.js';
import { declarationsAtWidth } from './responsive-css.js';

const html = readFileSync(REFERENCE_HTML, 'utf8');

/** The widths the reference draws each frame at, rounded to the viewport a screen would have. */
const DESKTOP = 1280;
const TABLET = 760;

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const TABS = [
  { label: 'Trades', icon: ICON, href: '/trades', current: true },
  { label: 'Passport', icon: ICON, href: '/passport' },
];
const NAV = [
  { label: 'Personal Info', icon: ICON, href: '/settings', current: true },
  { label: 'Verification', icon: ICON, href: '/settings/verification' },
];

const MOBILE = (
  <MobileShell
    header={
      <TopBar
        title="Enter code"
        back={{ label: 'Back' }}
        action={{ label: 'Alerts', icon: ICON, badge: true }}
      />
    }
    tabs={<TabBar items={TABS} />}
  >
    Body
  </MobileShell>
);
const LOGO_BAR = <LogoBar action={{ label: 'Alerts', icon: ICON, badge: true }} />;
const DESKTOP_SHELL = (
  <DesktopShell brandLabel="Account" nav={NAV}>
    Body
  </DesktopShell>
);
/** The same rail with no `href`, so the destination is a `<button>` rather than an `<a>`. */
const SIDE_NAV_BUTTONS = <SideNav brandLabel="Account" items={NAV.map(({ href: _href, ...rest }) => rest)} />;
const PUBLIC = (
  <PublicShell brandLabel="Komtru" aside="Hero">
    Listings
  </PublicShell>
);
const CONSOLE = (
  <ConsoleShell nav={NAV} title="Park Agents" description="Applications and custody." navFooter={<span />} />
);
const CONSOLE_RAIL = (
  <ConsoleShell collapsed nav={NAV} title="All Park Hubs" description="At tablet width." />
);

/** `<style id="komtru-nav-v2">` is the one that draws the TrustOps console shell. */
const OPS = 'komtru-nav-v2';

const DEVIATIONS: Record<string, Record<string, string>> = {
  'mweb-screen': {
    height:
      'The reference draws every mobile screen inside a 660px-tall scroll container inside a drawn ' +
      'phone. The product has no phone: the shell is the page, and the page is the viewport.',
    'overflow-y':
      'Same reason as the height — the inner scroller exists so the drawn phone can scroll inside ' +
      'the gallery. In a real browser the document scrolls, and an inner scroller would trap it.',
  },
  'dweb-content': {
    'overflow-y':
      'The gallery frame scrolls its content; a real page scrolls the document. An inner scroller ' +
      'here would strand the sidebar and break the sticky behaviour every screen above depends on.',
  },
  'public-content': {
    'overflow-y':
      'Same as dweb-content: the scroller belongs to the drawn browser frame, not to the page. A ' +
      'public profile is one scrolling document.',
  },
  'ko-dweb-shell': {
    'min-height':
      'The 620px floor sizes the gallery frame the console is drawn in. The console is a full ' +
      'application window, so the floor is the viewport instead.',
  },
  'ko-dweb-sidebar': {
    'box-sizing':
      "Tailwind's preflight already sets `box-sizing:border-box` on every element, so no utility " +
      'carries it and the compiled list cannot show it. The computed value is identical.',
    transition:
      'Written as the `transition` shorthand in the reference and as Tailwind’s three longhands ' +
      'here (`transition-[width,flex-basis] duration-[180ms] ease-[ease]`), which the diff cannot ' +
      'compare literally. The resulting property, duration and easing are the same.',
  },
  'ko-dweb-sidebar-collapsed': {
    'box-sizing': 'Inherited from the base rule — see ko-dweb-sidebar. Preflight carries it instead.',
    transition: 'Inherited from the base rule — see ko-dweb-sidebar.',
  },
  'ko-dweb-item': {
    'box-sizing':
      "Tailwind's preflight sets it on every element, so no utility in the list declares it while " +
      'the computed value is exactly the reference’s.',
  },
  'ko-dweb-item-active': {
    'box-sizing': 'Inherited from the base rule — see ko-dweb-item.',
  },
  'ko-dweb-item-collapsed': {
    'box-sizing': 'Inherited from the base rule — see ko-dweb-item.',
  },
};

const ADDITIONS: Record<string, readonly string[]> = {
  // The viewport takes the place of the gallery frame's fixed height.
  'mweb-screen': ['min-height'],
  // `.tb-dot` is `position:absolute` and the reference declares `position:relative` on `.tb-icon`
  // only. Every control is positioned here, so a dot can never resolve against the page instead of
  // its own button — which is a bug the reference's own markup never reaches, because it never
  // draws a dot on a back button.
  'scr-topbar-back': ['position'],
  // The sidebar is in the markup at every width and hidden below `lg`; the reference draws two
  // separate frames instead, so neither of its rules declares a display.
  'dweb-sidebar': ['display'],
  // `min-width:0` on a flex child is what stops a wide table from pushing the sidebar off-screen.
  // The reference's content never overflows, so it never needed it; a real screen does.
  'dweb-content': ['min-width'],
  // A `<button>` is neither full-width nor left-aligned by default; the reference's rail is a
  // `<div>`, so its rule declares neither.
  'dweb-item-button': ['width', 'text-align'],
  // `.tweb-content` declares padding and nothing else: the same element's `flex:1` and its
  // `min-width:0` guard are stated in `.dweb-content`, and neither stops applying at tablet.
  'tweb-content': ['min-width', 'flex-grow', 'flex-shrink', 'flex-basis'],

  // Tailwind composes a transition out of three longhands plus its own custom properties.
  'ko-dweb-sidebar': ['transition-property', 'transition-duration', 'transition-timing-function'],
  'ko-dweb-sidebar-collapsed': ['transition-property', 'transition-duration', 'transition-timing-function'],
  // `justify-start` undoes the `justify-center` the collapsed rail needs below `lg`. It is the
  // initial value, so the computed result is the reference's — it just has to be written.
  // `sm:flex-row` undoes the `flex-col` the page head needs below `sm`, which the reference states
  // in its own `@media(max-width:640px)` block. `row` is the initial value, so the computed result
  // is the reference's — a Tailwind shell just has to write it.
  'ko-page-head': ['flex-direction'],
  'ko-dweb-logo': ['justify-content'],
  'ko-dweb-item': ['justify-content'],
  'ko-dweb-item-active': ['justify-content'],
  // The reference's rail draws its glyphs as text (`▦`, `◌`); a console draws line icons, and
  // `stroke-current` is how they take the item's own colour.
  'ko-dweb-item-icon': ['stroke'],
};

const ROWS: ParityRow[] = [
  { id: 'mweb-screen', selector: '.mweb-screen', element: MOBILE, node: 0 },

  { id: 'scr-topbar', selector: '.scr-topbar', element: MOBILE, node: 1 },
  { id: 'scr-topbar-back', selector: '.scr-topbar .back-btn', element: MOBILE, node: 2 },
  { id: 'scr-topbar-back-icon', selector: '.scr-topbar .back-btn svg', element: MOBILE, node: 3 },
  { id: 'scr-topbar-title', selector: '.scr-topbar b', element: MOBILE, node: 4 },
  { id: 'scr-topbar-icon', selector: '.scr-topbar .tb-icon', element: MOBILE, node: 5 },
  { id: 'scr-topbar-icon-svg', selector: '.scr-topbar .tb-icon svg', element: MOBILE, node: 6 },
  { id: 'tb-dot', selector: '.tb-dot', element: MOBILE, node: 7 },
  { id: 'scr-body', selector: '.scr-body', element: MOBILE, node: 8 },

  { id: 'scr-tabbar', selector: '.scr-tabbar', element: MOBILE, node: 9 },
  { id: 'scr-tab', selector: '.scr-tabbar .tab', element: MOBILE, node: 13 },
  { id: 'scr-tab-icon', selector: '.scr-tabbar .tab svg', element: MOBILE, node: 14 },
  { id: 'scr-tab-label', selector: '.scr-tabbar .tab span', element: MOBILE, node: 15 },
  {
    id: 'scr-tab-active-icon',
    selector: '.scr-tabbar .tab.active svg',
    extends: ['.scr-tabbar .tab svg'],
    element: MOBILE,
    node: 11,
  },
  {
    id: 'scr-tab-active-label',
    selector: '.scr-tabbar .tab.active span',
    extends: ['.scr-tabbar .tab span'],
    element: MOBILE,
    node: 12,
  },

  { id: 'scr-logo-row', selector: '.scr-logo-row', element: LOGO_BAR, node: 0 },

  { id: 'dweb-sidebar', selector: '.dweb-sidebar', element: DESKTOP_SHELL, node: 6, width: DESKTOP },
  {
    id: 'dweb-sidebar-logo',
    selector: '.dweb-sidebar .ds-logo',
    element: DESKTOP_SHELL,
    node: 7,
    width: DESKTOP,
  },
  { id: 'dweb-item', selector: '.dweb-item', element: DESKTOP_SHELL, node: 10, width: DESKTOP },
  {
    id: 'dweb-item-active',
    selector: '.dweb-item.active',
    extends: ['.dweb-item'],
    element: DESKTOP_SHELL,
    node: 8,
    width: DESKTOP,
  },
  { id: 'dweb-item-icon', selector: '.dweb-item svg', element: DESKTOP_SHELL, node: 11, width: DESKTOP },
  {
    id: 'dweb-item-active-icon',
    selector: '.dweb-item.active svg',
    extends: ['.dweb-item svg'],
    element: DESKTOP_SHELL,
    node: 9,
    width: DESKTOP,
  },
  { id: 'dweb-content', selector: '.dweb-content', element: DESKTOP_SHELL, node: 12, width: DESKTOP },
  {
    // A destination with no `href` is a `<button>`, which does not fill its rail or left-align its
    // label on its own. Covered separately because the anchor rows above never reach that branch.
    id: 'dweb-item-button',
    selector: '.dweb-item',
    element: SIDE_NAV_BUTTONS,
    node: 4,
    width: DESKTOP,
  },

  { id: 'tweb-topnav', selector: '.tweb-topnav', element: DESKTOP_SHELL, node: 1, width: TABLET },
  {
    id: 'tweb-logo',
    selector: '.tweb-topnav .ds-logo',
    element: DESKTOP_SHELL,
    node: 2,
    width: TABLET,
  },
  { id: 'tweb-tabs', selector: '.tweb-tabs', element: DESKTOP_SHELL, node: 3, width: TABLET },
  { id: 'tweb-tab', selector: '.tweb-tabs .tt', element: DESKTOP_SHELL, node: 5, width: TABLET },
  {
    id: 'tweb-tab-active',
    selector: '.tweb-tabs .tt.active',
    extends: ['.tweb-tabs .tt'],
    element: DESKTOP_SHELL,
    node: 4,
    width: TABLET,
  },
  { id: 'tweb-content', selector: '.tweb-content', element: DESKTOP_SHELL, node: 12, width: TABLET },

  // D8 states its own split inline rather than in a rule, so what parity can pin on the public page
  // is the content region it shares with the app shell. The 280px rail is asserted in
  // PublicShell.test.tsx and at all four widths in four-widths.test.tsx.
  { id: 'public-content', selector: '.dweb-content', element: PUBLIC, node: 3, width: DESKTOP },

  { id: 'ko-dweb-shell', selector: '.ko-dweb-shell', styleId: OPS, element: CONSOLE, node: 0 },
  {
    id: 'ko-dweb-sidebar',
    selector: '.ko-dweb-sidebar',
    styleId: OPS,
    element: CONSOLE,
    node: 1,
    width: DESKTOP,
  },
  {
    id: 'ko-dweb-sidebar-collapsed',
    selector: '.ko-dweb-sidebar.collapsed',
    extends: ['.ko-dweb-sidebar'],
    styleId: OPS,
    element: CONSOLE,
    node: 1,
    width: TABLET,
  },
  {
    id: 'ko-dweb-logo',
    selector: '.ko-dweb-sidebar .ds-logo',
    styleId: OPS,
    element: CONSOLE,
    node: 2,
    width: DESKTOP,
  },
  {
    id: 'ko-dweb-logo-label-collapsed',
    selector: '.ko-dweb-sidebar.collapsed .ds-logo span',
    styleId: OPS,
    element: CONSOLE,
    node: 3,
    width: TABLET,
  },
  {
    id: 'ko-dweb-item',
    selector: '.ko-dweb-item',
    styleId: OPS,
    element: CONSOLE,
    node: 8,
    width: DESKTOP,
  },
  {
    id: 'ko-dweb-item-active',
    selector: '.ko-dweb-item.active',
    extends: ['.ko-dweb-item'],
    styleId: OPS,
    element: CONSOLE,
    node: 5,
    width: DESKTOP,
  },
  {
    id: 'ko-dweb-item-collapsed',
    selector: '.ko-dweb-sidebar.collapsed .ko-dweb-item',
    extends: ['.ko-dweb-item'],
    styleId: OPS,
    element: CONSOLE_RAIL,
    node: 8,
    width: TABLET,
  },
  {
    id: 'ko-dweb-item-icon',
    selector: '.ko-dweb-item > span:first-child',
    styleId: OPS,
    element: CONSOLE,
    node: 9,
    width: DESKTOP,
  },
  {
    id: 'ko-dweb-item-label-collapsed',
    selector: '.ko-dweb-sidebar.collapsed .ko-dweb-item > span:not(:first-child)',
    styleId: OPS,
    element: CONSOLE,
    node: 10,
    width: TABLET,
  },
  { id: 'ko-nav-divider', selector: '.ko-nav-divider', styleId: OPS, element: CONSOLE, node: 11 },
  {
    id: 'ko-dweb-content',
    selector: '.ko-dweb-content',
    styleId: OPS,
    element: CONSOLE,
    node: 12,
    width: DESKTOP,
  },
  { id: 'ko-page-head', selector: '.ko-page-head', styleId: OPS, element: CONSOLE, node: 13 },
  {
    // The reference stacks the page head under `@media(max-width:640px)`; 600 is inside it.
    id: 'ko-page-head-stacked',
    selector: '.ko-page-head',
    styleId: OPS,
    element: CONSOLE,
    node: 13,
    width: 600,
  },
  { id: 'ko-page-head-title', selector: '.ko-page-head h3', styleId: OPS, element: CONSOLE, node: 14 },
  { id: 'ko-page-head-sub', selector: '.ko-page-head p', styleId: OPS, element: CONSOLE, node: 15 },
];

describe('the rules the harness cannot merge', () => {
  it('still refuses `.dweb-shell`, whose two copies disagree', () => {
    // The reference declares `.dweb-shell{min-height:520px}` for one section and `560px` for
    // another, both in the same `<style>` block, so there is no copy to pick. `DesktopShell`
    // reproduces its `display:flex` and takes the viewport instead of either height, asserted in
    // DesktopShell.test.tsx. When the reference agrees with itself, this row can become a real one.
    expect(() => referenceRule(html, '.dweb-shell')).toThrow(/declares .* twice/);
  });
});

describeParity({
  html,
  rows: ROWS,
  deviations: DEVIATIONS,
  additions: ADDITIONS,
  declarations: declarationsAtWidth,
  // Every shell row is read at a width, including the ones whose rules carry no media query: the
  // reference's own sheets do, and merging an override into its base is how `.ko-page-head` reads
  // as the reference disagreeing with itself.
  defaultWidth: DESKTOP,
});
