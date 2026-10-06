import { KomtruMark } from '../brand/KomtruMark.js';
import { cx } from '../primitives/cx.js';

export interface ShellBrandProps {
  /** D9's sidebar reads "Account", NAV's "Komtru Ops", T1's "TechEdge NG". */
  label: string;
  /** Defaults to the Komtru mark at the size the lockup's rule draws it. */
  icon?: React.ReactNode;
  /** Hidden when the ops rail collapses; the mark stays. */
  labelClassName?: string;
  markSize?: number;
  className?: string;
}

/**
 * The `.ds-logo` lockup a shell's nav carries. Not `<KomtruLogo>`: these instances name the section
 * rather than the product ("Account", "TechEdge NG"), and each of the three rules that draws one
 * sets its own gap, type size and weight. `<KomtruLogo>` stays the brand lockup, which never varies.
 */
export function ShellBrand({
  label,
  icon,
  labelClassName,
  markSize = 16,
  className,
}: ShellBrandProps): React.JSX.Element {
  return (
    <div className={cx('flex items-center', className)}>
      {icon ?? <KomtruMark size={markSize} nodeRadius={2.2} />}
      <span className={labelClassName}>{label}</span>
    </div>
  );
}
