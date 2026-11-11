'use client';

import { useEffect, useState } from 'react';

/** The current time, refreshed on an interval, so a screen that compares a deadline with "now" does not go stale. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}
