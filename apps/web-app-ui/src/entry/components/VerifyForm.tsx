'use client';

import { useApiClient } from '@komtru/app-kit/react';
import { ProblemError, resendOtp } from '@komtru/api-client';
import { Banner, Button, OtpInput } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signUpCode, type SentCode } from '../drafts';
import { ENTRY, failureMessage, UNAVAILABLE } from '../flow';
import { proveCode, type CodeOutcome } from '../session-calls';
import {
  EntryFrame,
  EntryHeading,
  ErrorText,
  InlineLink,
  Lede,
  ResendLine,
  TrustNote,
  useResendCountdown,
} from './EntryFrame';
import { useDraft } from './useDraft';
import { useOpenSession } from './useOpenSession';

const FORM = 'verify-form';

type Shown =
  | { kind: 'none' }
  | { kind: 'wrong'; attemptsRemaining: number }
  | { kind: 'spent' }
  | { kind: 'taken' }
  | { kind: 'expired' }
  | { kind: 'message'; message: string };

const attempts = (left: number): string => `${String(left)} attempt${left === 1 ? '' : 's'}`;

/** What the person reads once a resend fails. */
function resendFailure(error: unknown): Shown {
  if (error instanceof ProblemError && error.status === 429) {
    return {
      kind: 'message',
      message: 'Too many codes requested. Wait a few minutes before asking for another.',
    };
  }
  // An unknown or expired challenge: the sign-up has to start again to get a new one.
  if (error instanceof ProblemError && error.status === 422) return { kind: 'expired' };
  return { kind: 'message', message: UNAVAILABLE };
}

/** Screens E3 and E3b — the code the sign-up sent, and what a wrong one looks like. */
export function VerifyForm(): React.JSX.Element {
  const client = useApiClient();
  const router = useRouter();
  const openSession = useOpenSession(undefined);
  const sent = useDraft(signUpCode);
  const [code, setCode] = useState('');
  const [shown, setShown] = useState<Shown>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const cells = useRef<HTMLDivElement>(null);
  /** Set once the session opens: forgetting the draft then is the flow finishing, not a cold start. */
  const finished = useRef(false);
  const secondsLeft = useResendCountdown(sent?.sentAt);

  useEffect(() => {
    if (sent === null && !finished.current) router.replace(ENTRY.signUp);
  }, [sent, router]);

  const focusFirstCell = () => {
    cells.current?.querySelector('input')?.focus();
  };

  const verify = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (sent === null || sent === undefined || code.length !== 6 || busy) return;
    setBusy(true);
    const outcome: CodeOutcome = await proveCode(sent.challengeId, code);
    if (outcome.kind === 'session') {
      finished.current = true;
      await openSession(outcome);
      return;
    }
    setBusy(false);
    switch (outcome.kind) {
      case 'wrong':
        setShown({ kind: 'wrong', attemptsRemaining: outcome.attemptsRemaining });
        return;
      case 'spent':
      case 'taken':
        setShown({ kind: outcome.kind });
        return;
      case 'limited':
      case 'unavailable':
        setShown({ kind: 'message', message: failureMessage(outcome) });
        return;
      // A reset token or another app's session cannot come back for a sign-up challenge.
      case 'reset':
      case 'wrong-scope':
        setShown({ kind: 'message', message: UNAVAILABLE });
        return;
    }
  };

  const resend = async () => {
    if (sent === null || sent === undefined || sending) return;
    setSending(true);
    try {
      const fresh = await client.call(resendOtp, { body: { challengeId: sent.challengeId } });
      const next: SentCode = { ...sent, challengeId: fresh.challengeId, delivered: true, sentAt: Date.now() };
      signUpCode.write(next);
      setCode('');
      setShown({ kind: 'none' });
      focusFirstCell();
    } catch (error) {
      setShown(resendFailure(error));
    } finally {
      setSending(false);
    }
  };

  const tryAgain = () => {
    setCode('');
    setShown({ kind: 'none' });
    focusFirstCell();
  };

  const footer = (() => {
    switch (shown.kind) {
      case 'wrong':
        return (
          <>
            <Button type="button" onClick={tryAgain}>
              Try again
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="mx-auto block"
              onClick={() => void resend()}
              disabled={sending}
            >
              Send a new code
            </Button>
          </>
        );
      case 'spent':
        return (
          <Button type="button" onClick={() => void resend()} disabled={sending}>
            {sending ? 'Sending…' : 'Send a new code'}
          </Button>
        );
      case 'taken':
        return (
          <Button asChild>
            <a href={ENTRY.login}>Log in</a>
          </Button>
        );
      case 'expired':
        return (
          <Button asChild>
            <a href={ENTRY.signUp}>Start again</a>
          </Button>
        );
      default:
        return (
          <Button type="submit" form={FORM} disabled={code.length !== 6 || busy}>
            {busy ? 'Checking…' : 'Verify & continue'}
          </Button>
        );
    }
  })();

  const wrong = shown.kind === 'wrong';

  return (
    <EntryFrame title="Enter code" back={ENTRY.terms} footer={footer}>
      <form id={FORM} onSubmit={(event) => void verify(event)}>
        <EntryHeading>Enter the 6-digit code</EntryHeading>
        <Lede>Sent to {sent?.destination ?? 'your phone'} via SMS.</Lede>
        {sent?.delivered === false && (
          <Banner tone="warning" title="We couldn't send a code just now">
            Wait a few minutes, then ask for a new one.
          </Banner>
        )}
        <div ref={cells}>
          <OtpInput
            label="Verification code"
            value={code}
            invalid={wrong}
            onChange={(value) => {
              setCode(value);
              if (wrong) setShown({ kind: 'none' });
            }}
          />
        </div>
        {shown.kind === 'wrong' && (
          <>
            <ErrorText>That code doesn&apos;t match — check the SMS and try again.</ErrorText>
            <p className="mb-[20px] text-[11.5px] text-trust-gray">
              {attempts(shown.attemptsRemaining)} remaining before we ask you to request a fresh code.
            </p>
          </>
        )}
        {shown.kind === 'spent' && (
          <ErrorText>That code can&apos;t be used any more. Send a new code to carry on.</ErrorText>
        )}
        {shown.kind === 'taken' && (
          <ErrorText>
            Another account verified this number first. <InlineLink href={ENTRY.login}>Log in</InlineLink>{' '}
            with that account instead.
          </ErrorText>
        )}
        {shown.kind === 'expired' && (
          <ErrorText>This sign-up has expired. Start again to get a new code.</ErrorText>
        )}
        {shown.kind === 'message' && <ErrorText>{shown.message}</ErrorText>}
        {shown.kind === 'none' && (
          <ResendLine secondsLeft={secondsLeft} sending={sending} onResend={() => void resend()} />
        )}
        <TrustNote icon="info">
          We text this code every time — Komtru never sends payment links by SMS. Treat any link claiming to
          be from us with suspicion.
        </TrustNote>
      </form>
    </EntryFrame>
  );
}
