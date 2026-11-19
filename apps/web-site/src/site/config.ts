/**
 * What the site needs from its environment, and what it does without.
 *
 * Every value here is a `NEXT_PUBLIC_*` one, written as a literal member expression because that is
 * the only form Next inlines into the browser bundle — `process.env[name]` reaches a `process.env`
 * that does not exist on the client.
 *
 * Read per call rather than at module scope: `next build` evaluates these modules on a machine
 * whose environment is not the deployment's.
 */

/** Trailing slash off, so `${appUrl}/login` never becomes `//login`. */
const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed.replace(/\/+$/, '');
};

/**
 * The backend, for the one call this site makes. Absent, the waitlist form keeps working and says
 * so — see `src/site/waitlist.ts`.
 */
export const apiUrl = (): string | undefined => clean(process.env.NEXT_PUBLIC_KOMTRU_API_URL);

/** This site's own origin, for canonical URLs and the QR code. */
export const siteUrl = (): string => clean(process.env.NEXT_PUBLIC_KOMTRU_SITE_URL) ?? 'https://komtru.com';

/**
 * THIS SITE DOES NOT LINK INTO THE APP, AND THAT IS DELIBERATE.
 *
 * Komtru is not open. The app is deployed at app.komtru.com, but its backend still runs with a
 * stub KYC provider and notifications in dry-run, so anyone who signed up there would wait forever
 * for a code that is never sent. Every call to action on this site goes to the waitlist instead,
 * and — the part that matters — every one of them is LABELLED "join the waitlist". A button that
 * says "Start a trade" and lands on a signup form is a promise the product cannot keep yet.
 *
 * This used to be implicit: `appLink()` read `NEXT_PUBLIC_KOMTRU_APP_URL` and fell back to
 * `/waitlist` when it was unset. That made "is the app reachable from the marketing site" an
 * accident of one environment variable — set it for any reason and the public site quietly starts
 * sending people into a half-configured product. It is now a property of the code, which cannot
 * change without review.
 *
 * TO OPEN THE APP: put the app's buttons back in `src/chrome/SiteNav.tsx`, `src/home/Hero.tsx` and
 * the `CtaCopy` constants, pointing at `https://app.komtru.com`. The copy is what has to change,
 * not a flag, because the words on the button are the thing that was wrong.
 */
