import type { Metadata } from 'next';
import { TermsUpdated } from '../../../src/entry/components/TermsScreens';
import { safeNext } from '../../../src/entry/flow';
import { first, type SearchParams } from '../search-params';

export const metadata: Metadata = { title: 'Terms updated' };

/** Gated: it interrupts someone with a session, which TOS1 never does. */
export default async function TermsUpdatedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  return <TermsUpdated next={safeNext(first((await searchParams).next))} />;
}
