import { KomtruMark } from '../brand/KomtruMark.js';
import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';
import { type NavItem, soleCurrent } from './NavItem.js';
import { ShellBrand } from './ShellBrand.js';

export interface TopNavProps {
  brandLabel: string;
  brandIcon?: React.ReactNode;
  /** Omitted draws the brand alone, which is what T3, T4 and T5 do. */
  items?: readonly NavItem[];
  label?: string;
  className?: string;
}

/**
 * `.tweb-topnav` — the tablet nav. The reference's rule for it, in its own words: "Sidebar → top
 * nav … not enough width for both nav and content comfortably."
 *
 * The tabs carry no icon: `.tweb-tabs .tt` is a text pill, and the reference draws it that way at
 * every width it appears.
 */
export function TopNav({
  brandLabel,
  brandIcon,
  items,
  label = 'Sections',
  className,
}: TopNavProps): React.JSX.Element {
  const current = items === undefined ? undefined : soleCurrent(items, 'TopNav');

  return (
    <header
      className={cx(
        'flex items-center justify-between border-b-[1px] border-b-border-hairline bg-surface-primary pt-[14px] pr-[18px] pb-[14px] pl-[18px]',
        className,
      )}
    >
      <ShellBrand
        label={brandLabel}
        icon={brandIcon ?? <KomtruMark size={15} nodeRadius={2.2} />}
        className="gap-[7px] font-display text-[13px] font-semibold"
      />
      {items !== undefined && (
        <nav aria-label={label} className="flex gap-[4px]">
          {items.map((item, index) => {
            const active = index === current;
            const tabClass = cx(
              'rounded-full pt-[6px] pr-[12px] pb-[6px] pl-[12px] text-[11.5px] font-semibold',
              active ? 'bg-trust-indigo-soft text-info-on-soft' : 'text-slate',
              FOCUS_RING,
            );

            return item.href === undefined ? (
              <button
                key={item.label}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={item.onSelect}
                className={tabClass}
              >
                {item.label}
              </button>
            ) : (
              <a
                key={item.label}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={tabClass}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      )}
    </header>
  );
}
