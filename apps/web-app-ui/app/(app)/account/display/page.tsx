import type { Metadata } from 'next';
import { DisplayScreen } from '../../../../src/account/display/DisplayScreen';
import { AccountScreen } from '../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Display & accessibility' };

/** Per request: the rail and the mode are facts about the person signed in. */
export const dynamic = 'force-dynamic';

/** SP-M33 (F-044): text size, contrast, motion and low-data mode, kept on this device. */
export default function DisplayPage(): React.JSX.Element {
  return (
    <AccountScreen section="display">
      <DisplayScreen />
    </AccountScreen>
  );
}
