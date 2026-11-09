import { PASSPORT_ROUTE_PREFIX } from './hosts';

/**
 * Paths this app serves to anyone, session or not.
 *
 * The Trust Passport is the product's front door: a buyer follows a link from WhatsApp before they
 * have an account, and the whole point of the page is that it can be checked by a stranger. The
 * offline document has to be reachable with no network and therefore no refresh call.
 */
export const PUBLIC_PATHS = [
  PASSPORT_ROUTE_PREFIX,
  '/offline',
  // The URL a person types, and screen E1: a stranger sees Welcome there, and someone with a
  // session is sent on to their mode's landing screen, which is gated like every other.
  '/',
] as const;

/**
 * The way in (T-111): every screen someone reaches before they have a session.
 *
 * Prefixes by whole segment, so `/signup` opens `/signup/terms` and `/reset-password` opens
 * `/reset-password/new`, while `/terms` does not open `/terms-updated` — that one interrupts a
 * signed-in person and is gated. Setting the first password after signup is `/set-password`, not
 * `/signup/password`, for the same reason: it runs on the session the verified code opened.
 *
 * The sign-in screen itself is `appSpec.signInPath`, which the gate always leaves open.
 */
export const ENTRY_PATHS = ['/signup', '/verify', '/reset-password', '/terms'] as const;
