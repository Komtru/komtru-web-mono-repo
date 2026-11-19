'use client';

import { useState } from 'react';
import { signOut } from '../entry/session-calls';

/**
 * Sign out, from Account.
 *
 * There was no way to sign out of this app at all: `signOut()` existed and only Close Account ever
 * called it, so the one route out of a session was to delete the account. On a shared or borrowed
 * phone that is not a gap in a settings screen, it is the whole problem.
 *
 * Not a `<SettingsRow>`: that is a link or a static row with a control, and this is an action. It
 * borrows the row's measurements so it sits in the group without looking bolted on, and is a real
 * `<button>` so it is reachable by keyboard and announced as something that does rather than
 * somewhere that goes.
 */
export function SignOutRow(): React.JSX.Element {
  const [leaving, setLeaving] = useState(false);

  const leave = async (): Promise<void> => {
    setLeaving(true);
    // Best effort by design: `signOut` clears this device's cookies even when the platform cannot
    // be reached, so a person on a bad connection is not stranded in a session they asked to end.
    await signOut();
    // A full document load, not a client navigation. Routing in place would leave the previous
    // person's fetched trades, messages and account data in the React tree and the query cache —
    // the exact thing someone signing out on a borrowed phone is trying to prevent.
    window.location.assign('/');
  };

  return (
    <button
      type="button"
      onClick={() => void leave()}
      disabled={leaving}
      className={
        'flex w-full items-center justify-between gap-[10px] border-t-[1px] border-t-border-hairline ' +
        'pt-[12px] pr-[14px] pb-[12px] pl-[14px] text-left first:border-t-0 ' +
        'disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 ' +
        'focus-visible:outline-trust-indigo'
      }
    >
      <span className="block text-[12.5px] font-semibold">{leaving ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}
