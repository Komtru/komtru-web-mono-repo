import type { Metadata } from 'next';
import { SecurityScreen } from '../../../../src/account/SecurityScreen';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Security' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SP-M04 (F-045): sign-in, two-step methods, backup codes, devices and signing out elsewhere. */
export default function SecurityPage(): React.JSX.Element {
  return (
    <AccountScreen section="security">
      <SecurityScreen />
    </AccountScreen>
  );
}
