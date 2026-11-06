import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MODE_COOKIE, rootDestination } from '../src/shell/nav';
import { resolveViewer } from '../src/shell/viewer';

/**
 * The app's root. v2 has no single home: Buy opens Home and Sell opens Shop, so the bare origin goes
 * to the landing screen of the mode the person is in rather than drawing a second home.
 */
export default async function Root(): Promise<never> {
  const viewer = await resolveViewer();
  redirect(rootDestination(viewer, (await cookies()).get(MODE_COOKIE)?.value));
}
