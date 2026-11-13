import { createSessionSealer, SESSION_COOKIE, SESSION_SECRET_ENV, type SessionSealer } from '@komtru/app-kit';
import { cookies } from 'next/headers';
import { ANONYMOUS_VIEWER, MODE_COOKIE, modeFor, type Mode, type Viewer } from './nav';
import { viewerFromHint } from './viewer-facts';

let sealer: { secret: string; sealer: SessionSealer } | undefined;

/** One sealer per secret: importing the HMAC key is the expensive part, and it is the same every request. */
const sealerFor = (secret: string): SessionSealer => {
  if (sealer?.secret !== secret) sealer = { secret, sealer: createSessionSealer(secret) };
  return sealer.sealer;
};

/**
 * Who the shell is being drawn for (F-037).
 *
 * The signed-in person's facts — has sold, is a certified merchant — arrive sealed in `komtru_session`,
 * written by the auth route on every sign-in and refresh (`describeViewer`), because a page render holds no
 * credential to ask the platform with. So they are as fresh as the last token refresh, which the client
 * makes lazily: on its first call after a page load, and whenever the access token lapses.
 *
 * Anything short of a hint this app sealed, unexpired, for a consumer session, is the anonymous viewer —
 * the smallest shell, so nothing appears that the person turns out not to have. A missing session secret is
 * that too, not an error: middleware already refuses to run without one, and Account must still render.
 * What the shell shows is never what the person may do: every route behind it authorises the caller.
 */
export async function resolveViewer(): Promise<Viewer> {
  const secret = process.env[SESSION_SECRET_ENV];
  if (secret === undefined || secret === '') return ANONYMOUS_VIEWER;
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    return viewerFromHint(await sealerFor(secret).open(token));
  } catch {
    return ANONYMOUS_VIEWER;
  }
}

/**
 * The mode the switch last chose, or the one the viewer is held to: a certified merchant is always in
 * Sell. Reads the request's cookies, so a page that calls it is rendered per request.
 */
export async function resolveMode(viewer: Viewer): Promise<Mode> {
  return modeFor(viewer, (await cookies()).get(MODE_COOKIE)?.value);
}
