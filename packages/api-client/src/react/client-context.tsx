'use client';

// Hands the app's one `ApiClient` to every hook below it, so a dropdown hook does not need the client
// threaded through props. Each app mounts it once, next to its QueryClientProvider.
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from '../client.js';

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error('useApiClient() needs an <ApiClientProvider> above it');
  return client;
}
