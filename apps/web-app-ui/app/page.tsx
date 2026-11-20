import { createSessionSealer, requireSessionSecret, SESSION_COOKIE } from '@komtru/app-kit';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Welcome } from '../src/entry/components/Welcome';
import { ROOT_DESTINATION } from '../src/shell/nav';

/**
 * The scope the sealed cookie names, or null. Built per request, not at module scope: `next build`
 * evaluates this module on a machine whose environment is not the app's.
 */
async function sessionScope(sealed: string | undefined): Promise<string | null> {
  const hint = await createSessionSealer(requireSessionSecret(process.env)).open(sealed, Date.now());
  return hint?.scope ?? null;
}

/**
 * The app's root, and screen E1.
 *
 * A stranger gets Welcome. Someone with a session goes on to Home: there is one navigation for
 * everyone, buying and selling alike.
 *
 * The sealed cookie is the same hint the session gate reads: a redirect, not an authorization
 * decision. Every screen behind it is gated again, and the backend checks every call.
 */
export default async function Root(): Promise<React.JSX.Element> {
  const jar = await cookies();
  if ((await sessionScope(jar.get(SESSION_COOKIE)?.value)) !== 'CONSUMER') return <Welcome />;
  redirect(ROOT_DESTINATION);
}

/** Per request: who is asking decides which of the two this is. */
export const dynamic = 'force-dynamic';
