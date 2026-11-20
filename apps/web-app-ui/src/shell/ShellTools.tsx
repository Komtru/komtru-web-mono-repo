'use client';

import { GlobalSearch } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { searchDestination } from './nav';

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
