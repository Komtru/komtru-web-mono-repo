import { redirect } from 'next/navigation';
import { appSpec } from '../src/app-config';

/** The bare origin. Middleware has already sent anyone without a LOGISTICS session to sign in. */
export default function Root(): never {
  redirect(appSpec.homePath);
}
