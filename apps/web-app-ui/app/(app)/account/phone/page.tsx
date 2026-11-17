import type { Metadata } from 'next';
import { ChangePhone } from '../../../../src/account/ChangePhone';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Change number' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SP-M05 (F-045): move to a new phone number. See `ChangePhone` for what the platform can and cannot do yet. */
export default function ChangePhonePage(): React.JSX.Element {
  return (
    <AccountScreen section="security">
      <ChangePhone />
    </AccountScreen>
  );
}
