import type { Metadata } from 'next';
import { Suspended } from '../../../../src/account/Suspended';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Account suspended' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** AS1 (F-045): the buyer's view of a suspended account. */
export default function AccountSuspendedPage(): React.JSX.Element {
  return (
    <AccountScreen>
      <Suspended />
    </AccountScreen>
  );
}
