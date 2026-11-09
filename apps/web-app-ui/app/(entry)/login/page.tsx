import type { Metadata } from 'next';
import { LoginForm, type LoginNotice } from '../../../src/entry/components/LoginForm';
import { safeNext } from '../../../src/entry/flow';
import { first, type SearchParams } from '../search-params';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  // `error=wrong-scope` is what the session gate sends when it clears another app's session.
  const notice: LoginNotice =
    first(params.reset) === 'done'
      ? 'reset-done'
      : first(params.error) === 'wrong-scope'
        ? 'wrong-scope'
        : undefined;
  return <LoginForm next={safeNext(first(params.next))} notice={notice} />;
}
