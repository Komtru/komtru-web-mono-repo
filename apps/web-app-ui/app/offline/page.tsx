import type { Metadata } from 'next';
import { EmptyState, OfflineBanner } from '@komtru/ui-kit';
import { AppShell } from '../../src/shell/AppShell';
import { ANONYMOUS_VIEWER } from '../../src/shell/nav';

export const metadata: Metadata = { title: 'Offline' };

/**
 * The document the service worker precaches and serves for a page nobody has opened yet. It is a
 * real route so it is built, cached and reviewable like any other screen.
 *
 * `<OfflineBanner>` directly rather than the shell's `<OfflineStatus>`: by the time a browser is
 * reading this out of the cache, being offline is the reason it is here, and a banner that waited
 * for `navigator.onLine` would flash on and off on the way back.
 *
 * The viewer is the anonymous one — nothing can be read with no connection — so the tab bar shows
 * the five destinations every account has.
 */
export default function OfflinePage(): React.JSX.Element {
  return (
    <AppShell viewer={ANONYMOUS_VIEWER}>
      <OfflineBanner>
        This screen hasn&apos;t been saved on this device yet, so there is nothing to show you.
      </OfflineBanner>
      <EmptyState
        title="This page needs a connection"
        body="Pages you have already opened still work offline. Anything you tapped is queued and will send itself once you're back."
      />
    </AppShell>
  );
}
