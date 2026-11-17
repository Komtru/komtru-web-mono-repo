'use client';

import { Button } from '@komtru/ui-kit';
import { ENTRY } from '../entry/flow';
import { EntryFrame, EntryHeading, Lede } from '../entry/components/EntryFrame';

/**
 * SP-M16: being signed out is explained, and one step puts the person back where they were. `next` is a path already
 * made safe by `safeNext`, so the way back can only be a screen of this app.
 *
 * The reference remembers the phone number so a code can be sent to it. Neither is done here: sign-in is a password (and
 * a second step for some), there is no sign-in by code to send, and a number kept on the device could be the last
 * person's on a shared phone. So the screen explains, then goes to the ordinary log in.
 */
export function SessionExpired({ next }: { next: string | undefined }): React.JSX.Element {
  const login = next === undefined ? ENTRY.login : `${ENTRY.login}?next=${encodeURIComponent(next)}`;
  return (
    <EntryFrame
      footer={
        <>
          <Button asChild>
            <a href={login}>Log in</a>
          </Button>
          <Button asChild variant="ghost" className="mx-auto block text-center">
            <a href={ENTRY.login}>Use a different account</a>
          </Button>
        </>
      }
    >
      <div className="pt-[24px]">
        <EntryHeading>Please sign in again</EntryHeading>
        <Lede>
          For your security we sign you out after a while, or when your account changes on another device.
        </Lede>
      </div>
    </EntryFrame>
  );
}
