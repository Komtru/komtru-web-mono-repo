'use client';

import { useRef } from 'react';
import { cx } from './cx.js';

export interface OtpInputProps {
  /** The reference's code is six digits; shorter codes exist nowhere in it. */
  length?: number;
  value: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  /**
   * The wrong-code screen paints every cell risk, not just the offending digit: the person is being
   * told the code is wrong, not which keystroke was.
   */
  invalid?: boolean;
  label: string;
  className?: string;
}

// No background here: the state branch below supplies the only one. Two background utilities on one
// element are resolved by stylesheet order, not by the order they are written, and Tailwind emits
// `.bg-surface-primary` and `.bg-risk-soft` *before* `.bg-surface-secondary` — so a base background
// silently beat both the filled and the invalid treatment, and the whole wrong-code state with it.
const CELL =
  'flex h-[52px] w-[42px] items-center justify-center rounded-sm border-[1.5px] border-solid ' +
  'text-center font-mono text-[20px] font-semibold';

/** `.otp-cell` — one box per digit, the filled ones outlined indigo, the caret's box ringed. */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  invalid = false,
  label,
  className,
}: OtpInputProps): React.JSX.Element {
  const cells = useRef<(HTMLInputElement | null)[]>([]);

  const commit = (next: string) => {
    onChange?.(next);
    if (next.length === length) onComplete?.(next);
  };

  /**
   * A code has no holes, so the value stays dense: tapping the fifth cell with one digit typed
   * writes into the second, rather than padding and then silently collapsing the gap. Returns where
   * the digit actually landed, which is what the caret follows.
   */
  const writeAt = (index: number, digit: string): number => {
    const chars = [...value];
    const target = Math.min(index, chars.length);
    chars[target] = digit;
    commit(chars.join('').slice(0, length));
    return target;
  };

  const clearAt = (index: number) => {
    if (index < 0 || index >= value.length) return;
    const chars = [...value];
    chars.splice(index, 1);
    commit(chars.join(''));
  };

  const focusCell = (index: number) => {
    cells.current[Math.min(Math.max(index, 0), length - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      className={cx('mb-[16px] flex gap-[8px]', className)}
    >
      {Array.from({ length }, (_, index) => {
        const digit = value[index] ?? '';
        return (
          <input
            key={index}
            ref={(node) => {
              cells.current[index] = node;
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            aria-label={`Digit ${index + 1} of ${length}`}
            value={digit}
            onChange={(event) => {
              const typed = event.target.value.replace(/\D/g, '').slice(-1);
              if (typed === '') return;
              focusCell(writeAt(index, typed) + 1);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace') {
                event.preventDefault();
                if (digit === '') {
                  clearAt(index - 1);
                  focusCell(index - 1);
                } else {
                  clearAt(index);
                }
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                focusCell(index - 1);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                focusCell(index + 1);
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
              if (pasted === '') return;
              commit(pasted);
              focusCell(pasted.length);
            }}
            className={cx(
              CELL,
              invalid
                ? 'border-risk bg-risk-soft'
                : digit === ''
                  ? 'border-border-hairline bg-surface-secondary'
                  : 'border-trust-indigo bg-surface-primary',
              'focus-visible:border-trust-indigo focus-visible:shadow-[0_0_0_3px_var(--trust-indigo-soft)]',
              'focus-visible:outline-none',
            )}
          />
        );
      })}
    </div>
  );
}
