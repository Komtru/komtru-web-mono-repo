import type { Metadata } from 'next';
import { PrivacyScreen } from '../../../../src/account/PrivacyScreen';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Privacy & data' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SP-M03 (F-045): what Komtru can use, and your data. */
export default function PrivacyPage(): React.JSX.Element {
  return (
    <AccountScreen section="privacy">
      <PrivacyScreen />
    </AccountScreen>
  );
}
