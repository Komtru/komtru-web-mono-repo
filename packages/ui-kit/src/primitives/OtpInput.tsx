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

const CELL =
  'flex h-[52px] w-[42px] items-center justify-center rounded-sm border-[1.5px] border-solid ' +
  'bg-surface-secondary text-center font-mono text-[20px] font-semibold';

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

  const setDigit = (index: number, digit: string) => {
    const padded = value.padEnd(length, ' ').split('');
    padded[index] = digit;
    commit(padded.join('').trimEnd().replace(/ /g, ''));
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
              setDigit(index, typed);
              focusCell(index + 1);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace') {
                event.preventDefault();
                if (digit === '') {
                  setDigit(index - 1, '');
                  focusCell(index - 1);
                } else {
                  setDigit(index, '');
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
                  ? 'border-border-hairline'
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
