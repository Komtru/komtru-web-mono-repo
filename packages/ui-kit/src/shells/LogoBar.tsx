import { KomtruLogo } from '../brand/KomtruLogo.js';
import { cx } from '../primitives/cx.js';
import { type TopBarAction, TopBarControl } from './TopBar.js';

export interface LogoBarProps {
  /** `'ops'` gives the staff lockup; omitted gives the consumer one. */
  product?: 'ops';
  action?: TopBarAction;
  /** The shell's own visibility, as on `<SideNav>`: an app with one shell hides this from `md` up. */
  className?: string;
}

/**
 * `.scr-logo-row` — the mobile top bar a tab's root screen carries: the brand, and at most one
 * action. Unlike `<TopBar>` it is not sticky and carries no bottom hairline; the reference draws it
 * flush against the body, because a tab root has nowhere to go back to.
 *
 * The lockup is `<KomtruLogo>` rather than a local one: `.scr-logo` never carries anything but the
 * product's own name, so there is nothing here for a caller to vary.
 */
export function LogoBar({ product, action, className }: LogoBarProps): React.JSX.Element {
  return (
    <header
      className={cx(
        'flex items-center justify-between bg-surface-primary pt-[16px] pr-[16px] pb-[10px] pl-[16px]',
        className,
      )}
    >
      <KomtruLogo product={product} />
      {action !== undefined && <TopBarControl action={action} />}
    </header>
  );
}
