import { cx } from './cx.js';

/** `.scr-label` — the small caps heading over a block of terms or fields. */
export function SectionLabel({
  children,
  as: Tag = 'h2',
  className,
}: {
  children: React.ReactNode;
  as?: 'h2' | 'h3' | 'p';
  className?: string;
}): React.JSX.Element {
  return (
    <Tag
      className={cx(
        'mb-[8px] mt-[18px] text-[11px] font-bold uppercase tracking-[.04em] text-slate first:mt-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
