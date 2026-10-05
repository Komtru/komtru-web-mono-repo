'use client';

import { useEffect, useRef } from 'react';
import { cx } from './cx.js';

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
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = panel.current?.ownerDocument.activeElement ?? null;
    opener.current = previous;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      // The reference pins the scrim inside its 340px phone frame; a real screen has no frame.
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
          if (event.key === 'Escape') onClose?.();
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
