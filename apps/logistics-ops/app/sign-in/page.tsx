import type { Metadata } from 'next';
import { safeNext } from '../../src/auth/sign-in';
import { AuthPage } from '../../src/components/AuthPage';
import { SignInForm } from '../../src/components/SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

type Search = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Search;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return (
    <AuthPage>
      <SignInForm next={safeNext(first(params.next))} wrongScope={first(params.error) === 'wrong-scope'} />
    </AuthPage>
  );
}
