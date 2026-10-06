import { HUB_APPLICATION_PATHS, PASSPORT_ROUTE_PREFIX } from './hosts';

/**
 * Paths this app serves to anyone, session or not.
 *
 * The Trust Passport is the product's front door: a buyer follows a link from WhatsApp before they
 * have an account, and the whole point of the page is that it can be checked by a stranger. The
 * offline document has to be reachable with no network and therefore no refresh call.
 */
export const PUBLIC_PATHS = [PASSPORT_ROUTE_PREFIX, '/offline'] as const;

/**
 * Paths that need a session and cannot have one yet.
 *
 * **T-111 deletes this list.** Entry and authentication is the next ticket: until it lands there is
 * no sign-in screen to send anyone to, and a gate with no gate-keeper behind it would make every
 * screen in the app a redirect to a 404. Everything here is a destination the scaffold has to be
 * able to draw — the five tabs, the Account sections and the Park Hub application.
 *
 * It is a list rather than a flag so that removing it is one deletion and the test below says what
 * changes when it goes: paths outside it are already gated, which is what proves the wiring works.
 */
export const PRE_AUTH_PUBLIC_PATHS = [
  '/trades',
  '/explore',
  '/shop',
  '/alerts',
  '/messages',
  '/account',
  ...HUB_APPLICATION_PATHS,
] as const;
