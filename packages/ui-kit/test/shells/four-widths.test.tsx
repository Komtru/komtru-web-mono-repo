/**
 * The ticket's own requirement: "Breakpoints exactly `sm` 640, `md` 768, `lg` 1024; a test renders
 * each shell at all four widths."
 *
 * Rendering alone would prove only that nothing throws, because jsdom evaluates no media query. So
 * each shell is rendered at each width *and* the decisive element's cascade is resolved at that
 * width through the real preset — the same machinery parity uses, which is what makes "the sidebar
 * appears at lg" an assertion rather than a reading of the class attribute.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS,
  ConsoleShell,
  DesktopShell,
  LogoBar,
  MobileShell,
  PublicShell,
  TabBar,
  TopBar,
} from '../../src/index.js';
import { classAttributes } from '../parity.js';
import { declarationsAtWidth } from '../responsive-css.js';

/** The three the reference names, plus one above `lg` — the width a desktop is actually used at. */
const WIDTHS = [BREAKPOINTS.sm, BREAKPOINTS.md, BREAKPOINTS.lg, 1440];

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const TABS = [
  { label: 'Trades', icon: ICON, href: '/trades', current: true },
  { label: 'Passport', icon: ICON, href: '/passport' },
];
const NAV = [
  { label: 'Personal Info', icon: ICON, href: '/settings', current: true },
  { label: 'Verification', icon: ICON, href: '/settings/verification' },
];

const SHELLS = [
  {
    name: 'MobileShell',
    element: (
      <MobileShell header={<LogoBar />} tabs={<TabBar items={TABS} />}>
        Body
      </MobileShell>
    ),
  },
  {
    name: 'MobileShell in a flow',
    element: <MobileShell header={<TopBar title="Enter code" back={{ label: 'Back' }} />}>Body</MobileShell>,
  },
  {
    name: 'DesktopShell',
    element: (
      <DesktopShell brandLabel="Account" nav={NAV}>
        Body
      </DesktopShell>
    ),
  },
  {
    name: 'PublicShell',
    element: (
      <PublicShell brandLabel="Komtru" aside="Hero">
        Listings
      </PublicShell>
    ),
  },
  { name: 'ConsoleShell', element: <ConsoleShell nav={NAV} title="Park Agents" /> },
  { name: 'ConsoleShell collapsed', element: <ConsoleShell collapsed nav={NAV} title="All Park Hubs" /> },
];

/**
 * The classes on the first element of a rendered shell carrying `marker`. Addressed by a class
 * rather than by position, unlike a parity row: here the element under test is picked out by the
 * very utility whose breakpoint is the subject, so a wrong match cannot pass.
 */
function classesWith(element: React.ReactElement, marker: string): string[] {
  const found = classAttributes(element).find((attribute) => attribute.split(/\s+/).includes(marker));
  if (found === undefined) throw new Error(`No element in this shell carries "${marker}"`);
  return found.split(/\s+/);
}

const [MOBILE, , DESKTOP_SHELL, PUBLIC, CONSOLE, CONSOLE_RAIL] = SHELLS.map((shell) => shell.element);

describe.each(WIDTHS)('at %ipx', (width) => {
  const atLg = width >= BREAKPOINTS.lg;

  it.each(SHELLS)('renders $name', ({ element }) => {
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain('<main');
  });

  it('swaps the consumer shell between top nav and sidebar at lg', async () => {
    const topNav = await declarationsAtWidth(classesWith(DESKTOP_SHELL!, 'lg:hidden'), width);
    const sideNav = await declarationsAtWidth(classesWith(DESKTOP_SHELL!, 'w-[180px]'), width);
    expect(topNav.get('display') === 'none', 'the top nav').toBe(atLg);
    expect(sideNav.get('display') === 'none', 'the sidebar').toBe(!atLg);
  });

  it('gives the consumer shell 20px of content padding below lg and 24px at lg', async () => {
    const main = await declarationsAtWidth(classesWith(DESKTOP_SHELL!, 'lg:p-[24px]'), width);
    expect(main.get('padding-top')).toBe(atLg ? '24px' : '20px');
    expect(main.get('padding-left')).toBe(atLg ? '24px' : '20px');
  });

  it('keeps the consumer shell a column below lg and a row at lg', async () => {
    const root = await declarationsAtWidth(classesWith(DESKTOP_SHELL!, 'min-h-dvh'), width);
    expect(root.get('flex-direction')).toBe(atLg ? 'row' : 'column');
  });

  it('gives the console a 68px rail below lg and a 228px sidebar at lg', async () => {
    const rail = await declarationsAtWidth(classesWith(CONSOLE!, 'basis-[68px]'), width);
    expect(rail.get('width')).toBe(atLg ? '228px' : '68px');
    expect(rail.get('flex-basis')).toBe(atLg ? '228px' : '68px');
  });

  it('keeps the console rail collapsed at every width when told to', async () => {
    const rail = await declarationsAtWidth(classesWith(CONSOLE_RAIL!, 'basis-[68px]'), width);
    expect(rail.get('width')).toBe('68px');
  });

  it('hides the console labels with the rail and shows them with the sidebar', async () => {
    const label = await declarationsAtWidth(classesWith(CONSOLE!, 'lg:inline'), width);
    expect(label.get('display') === 'none').toBe(!atLg);
    const collapsedLabel = await declarationsAtWidth(classesWith(CONSOLE_RAIL!, 'hidden'), width);
    expect(collapsedLabel.get('display')).toBe('none');
  });

  it('splits the public page into aside and main only at lg', async () => {
    const aside = await declarationsAtWidth(classesWith(PUBLIC!, 'lg:w-[280px]'), width);
    expect(aside.get('width')).toBe(atLg ? '280px' : '100%');
    const row = await declarationsAtWidth(classesWith(PUBLIC!, 'lg:flex-row'), width);
    expect(row.get('flex-direction')).toBe(atLg ? 'row' : 'column');
  });

  it('keeps the mobile shell the same shape at every width', async () => {
    // It carries no responsive variant at all. A phone layout widened is still the phone layout,
    // and an app serves `DesktopShell` from `md` rather than stretching this one.
    const tabBar = await declarationsAtWidth(classesWith(MOBILE!, 'mt-auto'), width);
    expect(tabBar).toEqual(await declarationsAtWidth(classesWith(MOBILE!, 'mt-auto'), BREAKPOINTS.sm));
    expect(tabBar.get('position')).toBe('sticky');
  });
});

describe('the breakpoints themselves', () => {
  it('switches exactly at 1024, not a pixel earlier', async () => {
    const sidebar = classesWith(DESKTOP_SHELL!, 'w-[180px]');
    expect((await declarationsAtWidth(sidebar, BREAKPOINTS.lg - 1)).get('display')).toBe('none');
    expect((await declarationsAtWidth(sidebar, BREAKPOINTS.lg)).get('display')).toBe('block');
  });

  it('stacks the console page head below 640 and lays it out in a row from 640', async () => {
    const head = classesWith(CONSOLE!, 'sm:flex-row');
    expect((await declarationsAtWidth(head, BREAKPOINTS.sm - 1)).get('flex-direction')).toBe('column');
    expect((await declarationsAtWidth(head, BREAKPOINTS.sm)).get('flex-direction')).toBe('row');
  });
});
