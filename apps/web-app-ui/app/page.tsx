import { redirect } from 'next/navigation';
import { appSpec } from '../src/app-config';

/**
 * The app's root. Trades is the home — the one list of every trade the person is party to, either
 * side of it (design §6.3) — so the bare origin goes there rather than drawing a second home.
 */
export default function Root(): never {
  redirect(appSpec.homePath);
}
