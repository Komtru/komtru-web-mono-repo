import type { Metadata } from 'next';
import { Statements } from '../../../../src/account/statements/Statements';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Statements' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SP-M13 (F-044): a statement for a period, as a CSV made from the person's payouts and refunds. */
export default function StatementsPage(): React.JSX.Element {
  return (
    <AccountScreen section="statements">
      <Statements />
    </AccountScreen>
  );
}
