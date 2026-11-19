/**
 * The one call this site makes.
 *
 * Komtru is not open yet, so the waitlist is the site's whole conversion goal: these are the people
 * who get told the day their city goes live. That is why it posts to the platform rather than to a
 * third party — the contact details belong in Komtru's own database, not in someone else's.
 */
import { apiUrl } from './config';

export const WAITLIST_INTENTS = ['BUY', 'SELL', 'BOTH'] as const;
export type WaitlistIntent = (typeof WAITLIST_INTENTS)[number];

export const WAITLIST_CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Jos', 'Other'] as const;

export interface WaitlistSignup {
  readonly name: string;
  /** A phone number or an email address; the platform decides which it is. */
  readonly contact: string;
  readonly intent: WaitlistIntent;
  readonly city: string;
}

export type WaitlistResult =
  | { kind: 'joined' }
  /** The platform is not reachable from this deployment, or said no. The visitor is told plainly. */
  | { kind: 'failed'; message: string };

/**
 * A phone number or an email address.
 *
 * Deliberately loose, and the same shape the reference used. This runs in front of a form whose
 * only job is to collect a way to reach someone; a stricter pattern here rejects real Nigerian
 * numbers written in forms this does not anticipate, and the platform validates it again anyway.
 */
const CONTACT = /^(\+?\d[\d\s-]{7,}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

export const isContact = (value: string): boolean => CONTACT.test(value.trim());

const UNREACHABLE =
  'We couldn’t reach Komtru just now. Please try again in a moment, or message us on WhatsApp.';

/**
 * Post a signup.
 *
 * With no `NEXT_PUBLIC_KOMTRU_API_URL` the call is not attempted and the visitor is told the
 * waitlist is not open — which beats a form that appears to succeed and keeps nothing. That is the
 * failure the reference shipped with: it wrote to `localStorage` and to a `window` hook nothing
 * ever set.
 */
export async function joinWaitlist(
  signup: WaitlistSignup,
  fetchImpl: typeof fetch = fetch,
): Promise<WaitlistResult> {
  const base = apiUrl();
  if (base === undefined) {
    return {
      kind: 'failed',
      message: 'The waitlist isn’t open from here yet. Please message us on WhatsApp and we’ll add you.',
    };
  }

  try {
    const response = await fetchImpl(`${base}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signup),
    });
    // 409 is a repeat signup, which from the visitor's side is a success: they are on the list.
    if (response.ok || response.status === 409) return { kind: 'joined' };
    return { kind: 'failed', message: UNREACHABLE };
  } catch {
    return { kind: 'failed', message: UNREACHABLE };
  }
}
