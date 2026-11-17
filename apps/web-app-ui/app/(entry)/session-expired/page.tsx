import type { Metadata } from 'next';
import { safeNext } from '../../../src/entry/flow';
import { SessionExpired } from '../../../src/system/SessionExpired';
import { first, type SearchParams } from '../search-params';

export const metadata: Metadata = { title: 'Signed out' };

/** SP-M16 (F-044): a session that ended on its own, explained, with one step back to where the person was. */
export default async function SessionExpiredPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <SessionExpired next={safeNext(first(params.next))} />;
}
