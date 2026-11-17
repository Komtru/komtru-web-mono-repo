import type { Metadata } from 'next';
import { TwoFactorSetup } from '../../../../../src/account/TwoFactorSetup';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Two-factor setup' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** TF1 and TF2 (F-045): the authenticator setup, then the backup codes, shown once. */
export default function TwoFactorPage(): React.JSX.Element {
  return (
    <AccountScreen section="security">
      <TwoFactorSetup />
    </AccountScreen>
  );
}
