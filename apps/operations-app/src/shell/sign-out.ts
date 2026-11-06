import { authRoutePaths } from '@komtru/api-client';

/**
 * Ends the session through the route handler, which revokes the refresh token and clears both
 * cookies. Best effort on the network and certain on the cookie: the handler clears them even when
 * the platform cannot be reached.
 */
export async function signOut(fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(authRoutePaths().logout, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allDevices: false }),
  }).catch(() => undefined);
}
