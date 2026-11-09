import { cx } from './cx.js';

const CLOCK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

/**
 * `.countdown-strip` — a clock and one line about a time that matters ("Inspection remaining · 41h 22m").
 * It prints the text it is given: working out how much time is left is the screen's job, and the screen
 * says "until" a date, never a count that would be wrong a minute later.
 */
export function CountdownStrip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      className={cx(
        'mb-[14px] flex items-center gap-[8px] rounded-md bg-warning-soft px-[12px] py-[9px] text-[12px] font-semibold text-warning-on-soft',
        className,
      )}
    >
      <span aria-hidden className="h-[16px] w-[16px] shrink-0 stroke-current">
        {CLOCK}
      </span>
      {children}
    </p>
  );
}
