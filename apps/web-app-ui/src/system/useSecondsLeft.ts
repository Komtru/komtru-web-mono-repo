'use client';

import { useEffect, useState } from 'react';

/**
 * Whole seconds left of a wait, counting down once a second. `undefined` for a wait nobody gave, so a screen says
 * nothing about time rather than invent one. The clock is read only in the timer, never while rendering. The wait is
 * read when the screen mounts: a new wait is a new screen.
 */
export function useSecondsLeft(total: number | undefined): number | undefined {
  const [left, setLeft] = useState(total);
  useEffect(() => {
    if (total === undefined || total <= 0) return;
    const endsAt = Date.now() + total * 1000;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [total]);
  return left;
}
