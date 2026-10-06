'use client';

import { useEffect, useRef } from 'react';
import { cx } from './cx.js';

/** Everything the browser would put in the tab order, which is what the trap has to cycle. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  children?: React.ReactNode;
  /** The sheet's actions; the reference stacks them at the bottom, destructive first. */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * `.bottom-sheet` — the reference's only overlay. There is no centred modal anywhere in the document:
 * a decision that needs confirming rises from the bottom of the screen the person is already on, with
 * that screen dimmed behind it rather than replaced.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: SheetProps): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = panel.current?.ownerDocument.activeElement ?? null;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      // The reference pins the scrim inside its 340px phone frame; a real screen has no frame.
      // The scrim colour is the reference's literal `rgba(13,20,32,.55)` — `--komtru-midnight` at
      // 55%. `bg-komtru-midnight/55` would be the token form, but Tailwind compiles that through
      // `color-mix()`, which no longer matches the reference byte for byte. `no-raw-hex` does not
      // see `rgba()`, so this is the note the rule would otherwise have demanded.
      className="fixed inset-0 z-20 flex items-end bg-[rgba(13,20,32,.55)]"
      onClick={() => onClose?.()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose?.();
            return;
          }
          if (event.key !== 'Tab') return;
          // `aria-modal` is a promise to assistive technology that the rest of the page is out of
          // reach; without a trap, Tab walks straight out behind the scrim and Escape stops working
          // because this handler is no longer in the event's path.
          const current = panel.current;
          if (current === null) return;
          const focusable = [...current.querySelectorAll<HTMLElement>(FOCUSABLE)];
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (first === undefined || last === undefined) {
            event.preventDefault();
            current.focus();
            return;
          }
          const active = current.ownerDocument.activeElement;
          if (event.shiftKey && (active === first || active === current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className={cx(
          'w-full rounded-t-[20px] rounded-b-[0] bg-surface-primary pt-[18px] px-[18px] pb-[20px]',
          'shadow-raised',
          className,
        )}
      >
        <div
          aria-hidden
          className="mt-0 mr-auto mb-[16px] ml-auto h-[4px] w-[36px] rounded-[2px] bg-stone-gray"
        />
        <h4 className="mb-[6px] text-center text-[16px] font-semibold">{title}</h4>
        {children}
        {footer}
      </div>
    </div>
  );
}
