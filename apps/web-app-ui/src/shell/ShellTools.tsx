'use client';

import { GlobalSearch, ModeSwitch, type ShellMode } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { landingFor, modeCookie, searchDestination } from './nav';

/**
 * The Buy/Sell switch beside the profile (Y2, F-083). Switching remembers the mode in a cookie the
 * server reads on the next request, opens the new mode's dashboard and refreshes so the navigation is
 * drawn for it. The cookie holds a view preference, not a permission: what a person may do is decided
 * on the server, whatever it says. Nobody is locked to one side: merchants buy too.
 */
export function ModeControl({ mode }: { mode: ShellMode }): React.JSX.Element {
  const router = useRouter();

  return (
    <ModeSwitch
      mode={mode}
      label="Buy or sell mode"
      onChange={(next) => {
        if (next === mode) return;
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
