'use client';

import { GlobalSearch, ModeSwitch, type ShellMode } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { landingFor, modeCookie, searchDestination } from './nav';

/**
 * The Buy/Sell switch beside the profile (Y2). Switching remembers the mode in a cookie the server
 * reads on the next request, opens the new mode's landing screen and refreshes so the navigation is
 * drawn for it. The cookie holds a view preference, not a permission: what a person may do is decided
 * on the server, whatever it says.
 */
export function ModeControl({ mode, locked }: { mode: ShellMode; locked: boolean }): React.JSX.Element {
  const router = useRouter();

  return (
    <ModeSwitch
      mode={mode}
      locked={locked}
      label="Buy or sell mode"
      lockedReason="Certified merchants sell only"
      onChange={(next) => {
        document.cookie = modeCookie(next, window.location.protocol === 'https:');
        router.push(landingFor(next));
        router.refresh();
      }}
    />
  );
}

/** DX-03's global search and Trade Code bar. */
export function SearchBar(): React.JSX.Element {
  const router = useRouter();

  return (
    <GlobalSearch
      label="Search"
      placeholder="Search your trades — or enter a Trade Code"
      onSearch={(query) => {
        const to = searchDestination(query);
        if (to !== undefined) router.push(to);
      }}
    />
  );
}
