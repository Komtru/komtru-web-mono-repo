export interface MobileShellProps {
  /** `<TopBar>` inside a flow, `<LogoBar>` at a tab's root. */
  header?: React.ReactNode;
  children?: React.ReactNode;
  /** `<StickyFooter>` — the screen's real actions, pinned above the fold. */
  footer?: React.ReactNode;
  /** `<TabBar>`. Mutually exclusive with `footer` in every screen the reference draws. */
  tabs?: React.ReactNode;
}

/**
 * The mobile web page: header, scrolling body, then whichever of the sticky footer and the tab bar
 * the screen carries.
 *
 * The reference draws every mobile screen inside `.mweb-screen`, a 660px-tall scroll container
 * inside a drawn phone. The product has no phone: the root is the viewport, so the fixed height and
 * the inner scroller are dropped and the document scrolls. Everything else — the column, the
 * `--surface-secondary` backdrop the cards sit on — is the reference's.
 */
export function MobileShell({ header, children, footer, tabs }: MobileShellProps): React.JSX.Element {
  return (
    <div className="relative flex min-h-dvh flex-col bg-surface-secondary">
      {header}
      {/* `.scr-body`'s 90px of bottom padding is what keeps the last card clear of the tab bar. */}
      <main className="flex-1 pt-[16px] pr-[16px] pb-[90px] pl-[16px]">{children}</main>
      {footer}
      {tabs}
    </div>
  );
}
