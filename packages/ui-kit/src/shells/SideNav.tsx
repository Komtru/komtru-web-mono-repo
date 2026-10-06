import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';
import { type NavItem, soleCurrent } from './NavItem.js';
import { ShellBrand } from './ShellBrand.js';

export interface SideNavProps {
  /** D9's sidebar is headed "Account", not "Komtru": it names the section, not the product. */
  brandLabel: string;
  brandIcon?: React.ReactNode;
  items: readonly NavItem[];
  label?: string;
  /** The shell's own visibility, which is the shell's decision, not the nav's. */
  className?: string;
}

/** `.dweb-sidebar` — the 180px consumer sidebar, and the `.dweb-item` rail inside it. */
export function SideNav({
  brandLabel,
  brandIcon,
  items,
  label = 'Sections',
  className,
}: SideNavProps): React.JSX.Element {
  const current = soleCurrent(items, 'SideNav');

  return (
    <aside
      className={cx(
        'w-[180px] shrink-0 border-r-[1px] border-r-border-hairline bg-surface-secondary pt-[18px] pr-[12px] pb-[18px] pl-[12px]',
        className,
      )}
    >
      <ShellBrand
        label={brandLabel}
        icon={brandIcon}
        className="mb-[20px] gap-[7px] px-[6px] font-display text-[13px] font-semibold"
      />
      <nav aria-label={label}>
        {items.map((item, index) => {
          const active = index === current;
          const content = (
            <>
              {/* The reference strokes `.dweb-item svg` and `.dweb-item.active svg` to exactly the
                  colour the item itself carries, so one `color` drives both. */}
              <span aria-hidden className="h-[15px] w-[15px] stroke-current">
                {item.icon}
              </span>
              {item.label}
            </>
          );
          const itemClass = cx(
            'mb-[2px] flex items-center gap-[9px] rounded-[8px] pt-[9px] pr-[10px] pb-[9px] pl-[10px] text-[12.5px] font-medium',
            active ? 'bg-trust-indigo-soft text-info-on-soft' : 'text-slate',
            FOCUS_RING,
          );

          return item.href === undefined ? (
            <button
              key={item.label}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={item.onSelect}
              className={cx(itemClass, 'w-full text-left')}
            >
              {content}
            </button>
          ) : (
            <a
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={itemClass}
            >
              {content}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
