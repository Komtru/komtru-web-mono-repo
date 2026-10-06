import type { NavItem } from './NavItem.js';
import { SideNav } from './SideNav.js';
import { TopNav } from './TopNav.js';

export interface DesktopShellProps {
  brandLabel: string;
  brandIcon?: React.ReactNode;
  /** One list, drawn two ways. Both navigations are in the markup; one of them is visible. */
  nav: readonly NavItem[];
  navLabel?: string;
  children?: React.ReactNode;
}

/**
 * `.dweb-shell` — the consumer app at width. The reference's rule: a 180px sidebar from `lg`, a top
 * nav below it, and content that steps from 20px of padding to 24px at the same breakpoint.
 *
 * Below `md` an app serves `<MobileShell>` instead — that is the reference's own rule, and the
 * reason it draws no desktop screen narrower than a tablet. This shell still lays out there, with
 * the top nav, because a screen that was never given a mobile design has to render *something*.
 *
 * The page's background comes from the shell, as it does on mobile: the reference states it on the
 * drawn frame (`.dweb-frame{background:var(--surface-primary)}`), which *is* the page once the
 * frame is gone, the same way `.mweb-screen`'s `--surface-secondary` is the mobile page's.
 *
 * Two deviations from the drawing, both the gallery's rather than the product's: `.dweb-shell`'s
 * `min-height` (declared twice, as 520px and 560px, for two sections of the document) becomes the
 * viewport, and `.dweb-content`'s `overflow-y:auto` goes — in a real page the document scrolls, and
 * an inner scroller would strand the sidebar's own overflow.
 */
export function DesktopShell({
  brandLabel,
  brandIcon,
  nav,
  navLabel,
  children,
}: DesktopShellProps): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-primary lg:flex-row">
      <TopNav
        brandLabel={brandLabel}
        brandIcon={brandIcon}
        items={nav}
        label={navLabel}
        className="lg:hidden"
      />
      <SideNav
        brandLabel={brandLabel}
        brandIcon={brandIcon}
        items={nav}
        label={navLabel}
        className="hidden lg:block"
      />
      <main className="min-w-0 flex-1 p-[20px] lg:p-[24px]">{children}</main>
    </div>
  );
}
