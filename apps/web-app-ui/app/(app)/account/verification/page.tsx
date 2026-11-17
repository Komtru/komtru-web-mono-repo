import type { Metadata } from 'next';
import { Verification } from '../../../../src/account/Verification';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Verification' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/**
 * VF1 (F-045): a verification that did not pass, why, and how to try again. The fuller verification screens (the level,
 * the badges) are F-046's; this holds the failure state, the in-flight note and the short checklist the reference's
 * success path also needs.
 */
export default function VerificationPage(): React.JSX.Element {
  return (
    <AccountScreen section="verification">
      <Verification />
    </AccountScreen>
  );
}
