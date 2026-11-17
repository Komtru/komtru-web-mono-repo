'use client';

import { Button } from '@komtru/ui-kit';
import { countdown, ENTRY } from '../entry/flow';
import { EntryFrame, TrustNote } from '../entry/components/EntryFrame';
import { SystemHero } from './SystemHero';
import { useSecondsLeft } from './useSecondsLeft';

/**
 * SP-M17: a lockout that says how long, why, and what to do instead. `waitSeconds` is the platform's own `Retry-After`;
 * with none, no clock is drawn and nothing is promised about time. Counting down to zero releases "Back to log in", so
 * the person is not tempted to hammer a form that will only refuse them again.
 *
 * "Recover my account" goes to the password reset, the one recovery a signed-out person has. The reference's "Contact
 * support" is not drawn: there is no support inbox yet (SP-M06 is T-129's) and a signed-out person has no reference to give.
 */
export function TooManyAttempts({
  waitSeconds,
  onRetry,
}: {
  waitSeconds: number | undefined;
  onRetry: () => void;
}): React.JSX.Element {
  const left = useSecondsLeft(waitSeconds);
  const waiting = left !== undefined && left > 0;
  return (
    <EntryFrame
      footer={
        <>
          <Button asChild>
            <a href={ENTRY.forgot}>Recover my account</a>
          </Button>
          <Button type="button" variant="secondary" disabled={waiting} onClick={onRetry}>
            Back to log in
          </Button>
        </>
      }
    >
      <div className="pt-[24px] text-center">
        <SystemHero mark="alert" title="Too many tries">
          To keep your account safe, sign-in is paused for a little while.
        </SystemHero>
        {left !== undefined && (
          <p
            role="timer"
            aria-label="Time until you can try again"
            className="mb-[20px] font-mono text-[28px] font-semibold"
          >
            {countdown(left)}
          </p>
        )}
      </div>
      <TrustNote icon="info">
        Forgot your code or lost your phone? You don’t need to wait: we can help you recover your account.
      </TrustNote>
    </EntryFrame>
  );
}
