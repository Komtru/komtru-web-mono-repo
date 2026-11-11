'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { AFTER_WELCOME } from './steps';
import { subscribeWelcome, welcomeArrived, welcomeDone } from './state';

type Gate = 'pending' | 'show' | 'leave';

/**
 * Whether a welcome screen may be drawn, and the redirect when it may not. `false` until the client has looked, so a
 * person who should not be here never sees the screen flash before they are sent on.
 *
 * Once is once: the walkthrough screens (`'walkthrough'`) are closed to a person who finished or skipped, whatever
 * brought them back — a back button, a reload or a bookmark. OB5 (`'done'`) is the opposite: it is only for someone
 * who came through OB4 in this tab, so a deep link to it goes to the app instead. The mark lives on the device, which
 * is why this reads it on the client.
 */
export function useWelcomeGate(mode: 'walkthrough' | 'done' = 'walkthrough'): boolean {
  const router = useRouter();
  const gate = useSyncExternalStore(
    subscribeWelcome,
    (): Gate => {
      const leave = mode === 'walkthrough' ? welcomeDone() : !welcomeArrived();
      return leave ? 'leave' : 'show';
    },
    (): Gate => 'pending',
  );
  useEffect(() => {
    if (gate === 'leave') router.replace(AFTER_WELCOME);
  }, [gate, router]);
  return gate === 'show';
}
