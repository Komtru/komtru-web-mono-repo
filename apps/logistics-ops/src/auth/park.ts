// T-160: a Park Agent who signs in here is sent to the Park app. A Park Agent and a courier operator
// hold the same LOGISTICS scope, so only the backend's answer about the company tells them apart:
// Park is the one default company (`isDefault`).
import type { LogisticsMe } from '@komtru/api-client';
import { safeNext } from './sign-in';

export type Destination = { kind: 'portal'; path: string } | { kind: 'park'; url: string };

/**
 * Where a signed-in person goes. `parkUrl` missing (an unconfigured environment) still keeps a Park
 * Agent out of the portal: they land on the Park app's production host rather than on courier screens.
 */
export function destinationFor(
  me: Pick<LogisticsMe, 'company'>,
  next: string | undefined,
  home: string,
  parkUrl: string | undefined,
): Destination {
  if (me.company.isDefault) return { kind: 'park', url: parkUrl ?? 'https://park.komtru.com' };
  return { kind: 'portal', path: safeNext(next) ?? home };
}

/**
 * `NEXT_PUBLIC_KOMTRU_PARK_URL` (`PARK_URL_ENV`), written out literally: Next inlines a public variable
 * into the client bundle only where it appears verbatim.
 */
export const parkUrl = (): string | undefined => {
  const value = process.env.NEXT_PUBLIC_KOMTRU_PARK_URL;
  return value === undefined || value === '' ? undefined : value;
};
