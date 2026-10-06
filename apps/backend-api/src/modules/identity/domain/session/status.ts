// The one list of statuses a session may be opened, used and refreshed under (M1 D5, §9.1).
//
// It lives here rather than in either service because both need it and they must agree: if
// `resolvePrincipal` admitted a status `refreshSession` refuses, a suspended user would keep working
// until their access token lapsed. One copy, imported twice.
export const USABLE_STATUSES: ReadonlySet<string> = new Set(['ACTIVE', 'PENDING_VERIFICATION', 'RESTRICTED']);

export const sessionUsableUnder = (status: string): boolean => USABLE_STATUSES.has(status);
