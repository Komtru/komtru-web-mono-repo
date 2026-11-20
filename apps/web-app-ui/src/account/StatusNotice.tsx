'use client';

import { useMe } from '@komtru/api-client/react';
import { Banner } from '@komtru/ui-kit';

const WORDS = {
  SUSPENDED: 'Your account is suspended',
  RESTRICTED: 'Your account is restricted',
  LOCKED: 'Your account is locked',
} as const;

/**
 * The way into AS1 and AS2. A restricted, suspended or locked account sees this on Account, above its sections, with a link
 * to what it means; anyone else sees nothing, and so does anyone while the read is in flight or has failed (this is a
 * pointer, not a screen: the screen it points to has the loading, error and offline states). Nothing redirects someone
 * to AS1 or AS2 on its own: that needs middleware that knows the account's state, which this ticket does not add.
 */
export function StatusNotice({ seller = false }: { seller?: boolean }): React.JSX.Element | null {
  const me = useMe();
  const status = me.data?.account.status;
  if (status !== 'SUSPENDED' && status !== 'RESTRICTED' && status !== 'LOCKED') return null;

  return (
    <Banner tone="warning" title={WORDS[status]}>
      <a href={seller ? '/account/suspended/selling' : '/account/suspended'} className="underline">
        See what this means
      </a>
    </Banner>
  );
}
