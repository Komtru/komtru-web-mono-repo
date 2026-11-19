import type { Metadata } from 'next';
import { SignUpForm } from '../../../src/entry/components/SignUpForm';
import { safeNext } from '../../../src/entry/flow';
import { first, type SearchParams } from '../search-params';

export const metadata: Metadata = { title: 'Create account' };

/** `next` is where a visitor was going before they chose to sign up, such as a Trade Code lookup. */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const next = safeNext(first((await searchParams).next));
  return <SignUpForm {...(next === undefined ? {} : { next })} />;
}
