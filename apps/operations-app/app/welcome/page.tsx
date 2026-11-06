import type { Metadata } from 'next';
import { AuthPage } from '../../src/components/AuthPage';
import { WelcomeFlow } from '../../src/components/WelcomeFlow';

export const metadata: Metadata = { title: 'Welcome' };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Search;
}): Promise<React.JSX.Element> {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;
  return (
    <AuthPage width={920}>
      <WelcomeFlow token={value === undefined || value === '' ? undefined : value} />
    </AuthPage>
  );
}
