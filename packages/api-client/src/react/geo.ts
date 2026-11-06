'use client';

// `useStates()` and `useCities(stateId)`: the dropdown hooks every app shares (T-046). Each returns a
// TanStack query holding the whole list, flattened, so a `<select>` renders from `data` directly.
//
// The catalog changes only when staff change it, and the backend revalidates with an ETag, so a long
// `staleTime` costs one 304 now and then; a fresh city reaches a mounted dropdown on its next refetch.
import { useQuery } from '@tanstack/react-query';
import type { City, State } from '@komtru/shared-types';
import type { ApiClient } from '../client.js';
import { fetchAllCities, fetchAllStates } from '../geo.js';
import { useApiClient } from './client-context.js';

export const GEO_STALE_TIME_MS = 10 * 60 * 1000;

export const geoKeys = {
  all: ['geo'] as const,
  states: ['geo', 'states'] as const,
  cities: (stateId: string) => ['geo', 'cities', stateId] as const,
};

export const statesQueryOptions = (client: ApiClient) => ({
  queryKey: geoKeys.states,
  queryFn: ({ signal }: { signal: AbortSignal }): Promise<State[]> => fetchAllStates(client, signal),
  staleTime: GEO_STALE_TIME_MS,
});

export const citiesQueryOptions = (client: ApiClient, stateId: string) => ({
  queryKey: geoKeys.cities(stateId),
  queryFn: ({ signal }: { signal: AbortSignal }): Promise<City[]> => fetchAllCities(client, stateId, signal),
  staleTime: GEO_STALE_TIME_MS,
});

/** Nigeria's 36 states and the FCT. */
export function useStates() {
  const client = useApiClient();
  return useQuery(statesQueryOptions(client));
}

/**
 * The active cities of the chosen state. Idle until a state is chosen, and keyed by state, so
 * switching state shows that state's list (cached after the first time) and never the previous one's.
 */
export function useCities(stateId: string | null | undefined) {
  const client = useApiClient();
  return useQuery({
    ...citiesQueryOptions(client, stateId ?? ''),
    enabled: Boolean(stateId),
  });
}
