import type { Metadata } from 'next';
import { SetPasswordForm } from '../../../src/entry/components/PasswordReset';
import { safeNext } from '../../../src/entry/flow';
import { first, type SearchParams } from '../search-params';

export const metadata: Metadata = { title: 'Create password' };

/** Gated: it runs on the session the verified code opened. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  return <SetPasswordForm next={safeNext(first((await searchParams).next))} />;
}
