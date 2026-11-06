import { redirect } from 'next/navigation';
import { appSpec } from '../src/app-config';

/**
 * The bare origin. Middleware has already sent anyone without a STAFF session to sign in, so what
 * reaches here is a signed-in person; the Work Queue decides whether they may stay (a section the
 * viewer has no permission for says so rather than redirecting in a loop).
 */
export default function Root(): never {
  redirect(appSpec.homePath);
}
