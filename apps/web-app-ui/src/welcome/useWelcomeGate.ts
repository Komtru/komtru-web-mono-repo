'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AFTER_WELCOME } from './steps';
import { welcomeDone } from './state';

/**
 * Once is once: a person who finished or skipped is not walked through it again by a back button, a reload or a
 * bookmark. Read on the client because the mark lives on the device.
 */
export function useWelcomeGate(): void {
  const router = useRouter();
  useEffect(() => {
    if (welcomeDone()) router.replace(AFTER_WELCOME);
  }, [router]);
}
