import type { Metadata } from 'next';
import { CloseAccount } from '../../../../src/account/CloseAccount';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Close account' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/**
 * CA1 and CA2 (F-045). `?erase=1` is "Delete my data" from Privacy: the platform's erasure request closes the account
 * first, so it is the same two screens with the words changed to say so.
 */
export default async function CloseAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ erase?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const { erase } = await searchParams;
  return (
    <AccountScreen section="privacy">
      <CloseAccount erase={erase === '1'} />
    </AccountScreen>
  );
}
