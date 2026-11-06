'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '../primitives/cx.js';

export interface GlobalSearchProps {
  placeholder: string;
  /** Names the field and the search landmark. */
  label: string;
  onSearch: (query: string) => void;
  /** The reference's own line beside the field. */
  hint?: string;
  className?: string;
}

const TYPING_IN = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * DX-03's global search and Trade Code bar: one field, always on top, and `/` to reach it from
 * anywhere. `/` is left alone while someone is typing in a field, and with a modifier held.
 */
export function GlobalSearch({
  placeholder,
  label,
  onSearch,
  hint = 'press / to search',
  className,
}: GlobalSearchProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest(TYPING_IN) !== null) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <form
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value);
      }}
      className={cx('flex min-w-0 flex-1 items-center gap-[12px]', className)}
    >
      <div className="relative min-w-0 max-w-[460px] flex-1">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          strokeLinecap="round"
          strokeWidth="2"
          className="absolute top-1/2 left-[12px] h-[15px] w-[15px] -translate-y-1/2 stroke-trust-gray"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={input}
          type="search"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-[8px] border-[1.5px] border-border-hairline bg-surface-elevated pt-[9px] pr-[12px] pb-[9px] pl-[36px] text-[13px] text-midnight-text"
        />
      </div>
      <span className="font-mono text-[10.5px] text-trust-gray">{hint}</span>
    </form>
  );
}
