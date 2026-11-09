'use client';

import { Banner, Button, OtpInput, TextField } from '@komtru/ui-kit';
import { useState } from 'react';
import { defaultFactor, ENTRY, factorLabel, failureMessage, needsSend, usableFactors } from '../flow';
import {
  proveFactor,
  sendFactorCode,
  signIn,
  type AccountNotice,
  type Factor,
  type MfaChallenge,
  type SendOutcome,
  type SignInOutcome,
} from '../session-calls';
import { EntryFrame, EntryHeading, ErrorText, InlineLink, Lede } from './EntryFrame';
import { useOpenSession } from './useOpenSession';

const FORM = 'login-form';

/** Why the person landed here, read from the query by the page. */
export type LoginNotice = 'reset-done' | 'wrong-scope' | undefined;

const NOTICE_COPY: Record<NonNullable<AccountNotice['noticeKey']>, string> = {
  ACCOUNT_RESTRICTED: 'Some things are paused on this account.',
  ACCOUNT_SUSPENDED: 'This account is suspended.',
  ACCOUNT_LOCKED: 'This account is locked.',
  ACCOUNT_CLOSED: 'This account is closed.',
};

function messageFor(outcome: Exclude<SignInOutcome, { kind: 'session' } | { kind: 'mfa' }>): React.ReactNode {
  switch (outcome.kind) {
    case 'rejected':
      return (
        <>
          Those details don&apos;t match an account. Check them and try again, or{' '}
          <InlineLink href={ENTRY.forgot}>reset your password</InlineLink>.
        </>
      );
    case 'notice':
      return (
        <>
          {outcome.notice.noticeKey === null
            ? 'This account cannot sign in.'
            : NOTICE_COPY[outcome.notice.noticeKey]}{' '}
          Contact support and quote reference {outcome.notice.supportReference}.
        </>
      );
    case 'wrong-scope':
      return "This account can't sign in here. Komtru staff use the operations console.";
    case 'limited':
    case 'unavailable':
      return failureMessage(outcome);
  }
}

/** Screen E4 — returning users. A sign-in that owes a second factor continues on the same page. */
export function LoginForm({
  next,
  notice,
}: {
  next: string | undefined;
  notice: LoginNotice;
}): React.JSX.Element {
  const openSession = useOpenSession(next);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<React.ReactNode>(null);
  const [challenge, setChallenge] = useState<{
    challenge: MfaChallenge;
    firstSend: SendOutcome | undefined;
  } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (identifier.trim() === '' || password === '') {
      setProblem('Enter your phone number and password.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const outcome = await signIn(identifier, password);
    if (outcome.kind === 'session') {
      await openSession(outcome);
      return;
    }
    if (outcome.kind === 'mfa') {
      // A text or email factor has to be asked for its code; it is asked here, once, rather than
      // from an effect that would ask again on every remount.
      const first = defaultFactor(outcome.challenge.factors);
      const firstSend =
        first !== undefined && needsSend(first) ? await sendFactorCode(outcome.challenge, first) : undefined;
      setBusy(false);
      setPassword('');
      setChallenge({ challenge: outcome.challenge, firstSend });
      return;
    }
    setBusy(false);
    setProblem(messageFor(outcome));
  };

  if (challenge !== null) {
    return (
      <SecondFactor
        challenge={challenge.challenge}
        firstSend={challenge.firstSend}
        onBack={() => {
          setChallenge(null);
        }}
        onOpened={openSession}
      />
    );
  }

  return (
    <EntryFrame
      title="Log in"
      back={ENTRY.welcome}
      footer={
        <>
          <Button type="submit" form={FORM} disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </Button>
          <p className="m-0 text-center text-[11.5px] text-slate">
            New to Komtru? <InlineLink href={ENTRY.signUp}>Create an account</InlineLink>
          </p>
        </>
      }
    >
      <form id={FORM} onSubmit={(event) => void submit(event)} noValidate>
        <h1 className="sr-only">Log in to Komtru</h1>
        {notice === 'reset-done' && (
          <Banner tone="success" title="Your password is updated">
            Log in with your new password.
          </Banner>
        )}
        {notice === 'wrong-scope' && (
          <Banner tone="warning" title="Signed out">
            That session belonged to another Komtru app. Log in with your Komtru account.
          </Banner>
        )}
        <TextField
          label="Phone number"
          type="text"
          // Text, not tel: the field takes an email or a username too, and a phone keypad has no @.
          inputMode="text"
          autoComplete="username"
          placeholder="080X XXX XXXX"
          helper="Your email or username works too."
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
          }}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        {problem !== null && <ErrorText>{problem}</ErrorText>}
        <Button asChild variant="ghost">
          <a href={ENTRY.forgot}>Forgot password?</a>
        </Button>
      </form>
    </EntryFrame>
  );
}

/**
 * The second step of a sign-in that owes one (T-036). The reference draws no consumer screen for it,
 * so it is E3's code entry with the factor named: six cells for a code, a text field for a recovery
 * code. A passkey needs the WebAuthn ceremony, which this screen does not run, so it is not offered.
 */
/** What a send says to the person: where the code went, or why it did not. */
const describeSend = (
  sent: SendOutcome | undefined,
): { destination: string | null; problem: string | null } => {
  if (sent === undefined) return { destination: null, problem: null };
  if (sent.kind === 'sent') {
    return {
      destination: sent.destination,
      problem: sent.delivered
        ? null
        : "We couldn't send a code just now. Wait a few minutes, then try again.",
    };
  }
  if (sent.kind === 'spent')
    return { destination: null, problem: 'This sign-in has expired. Go back and log in again.' };
  return { destination: null, problem: failureMessage(sent) };
};

function SecondFactor({
  challenge,
  firstSend,
  onBack,
  onOpened,
}: {
  challenge: MfaChallenge;
  firstSend: SendOutcome | undefined;
  onBack: () => void;
  onOpened: (opened: Extract<SignInOutcome, { kind: 'session' }>) => Promise<void>;
}): React.JSX.Element {
  const factors = usableFactors(challenge.factors);
  const [factor, setFactor] = useState<Factor | undefined>(() => defaultFactor(challenge.factors));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [problem, setProblem] = useState<string | null>(() => describeSend(firstSend).problem);
  const [destination, setDestination] = useState<string | null>(() => describeSend(firstSend).destination);

  const choose = async (option: Factor) => {
    setFactor(option);
    setCode('');
    setWrong(false);
    setProblem(null);
    setDestination(null);
    if (!needsSend(option)) return;
    const shown = describeSend(await sendFactorCode(challenge, option));
    setDestination(shown.destination);
    setProblem(shown.problem);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (factor === undefined || code.trim() === '' || busy) return;
    setBusy(true);
    setProblem(null);
    const outcome = await proveFactor(challenge, factor, code);
    if (outcome.kind === 'session') {
      await onOpened(outcome);
      return;
    }
    setBusy(false);
    if (outcome.kind === 'wrong-code') {
      setWrong(true);
      const left = outcome.attemptsRemaining;
      setProblem(
        `That code doesn't match. Check it and try again — ${String(left)} attempt${left === 1 ? '' : 's'} left.`,
      );
      return;
    }
    if (outcome.kind === 'challenge-spent') {
      setWrong(true);
      setProblem('This sign-in has expired. Go back and log in again.');
      return;
    }
    if (outcome.kind === 'limited' || outcome.kind === 'unavailable') {
      setProblem(failureMessage(outcome));
      return;
    }
    setProblem('This sign-in could not be finished. Go back and log in again.');
  };

  const recovery = factor?.type === 'RECOVERY_CODE';

  return (
    <EntryFrame
      title="Confirm it's you"
      footer={
        <>
          <Button type="submit" form="mfa-form" disabled={factor === undefined || code.trim() === '' || busy}>
            {busy ? 'Checking…' : 'Verify & log in'}
          </Button>
          <Button type="button" variant="ghost" className="mx-auto block" onClick={onBack}>
            Back to log in
          </Button>
        </>
      }
    >
      <form id="mfa-form" onSubmit={(event) => void submit(event)}>
        <EntryHeading>{recovery ? 'Enter a recovery code' : 'Enter the 6-digit code'}</EntryHeading>
        {factor === undefined ? (
          <ErrorText>
            This account signs in with a passkey, which this screen can&apos;t use yet. Contact support to get
            back in.
          </ErrorText>
        ) : (
          <>
            <Lede>
              {factor.type === 'TOTP'
                ? 'Open your authenticator app and enter the code it shows for Komtru.'
                : recovery
                  ? 'Use one of the recovery codes you saved when you turned on two-step sign-in.'
                  : `Sent to ${destination ?? factor.hint ?? 'you'}.`}
            </Lede>
            {recovery ? (
              <TextField
                label="Recovery code"
                autoComplete="one-time-code"
                mono
                value={code}
                invalid={wrong}
                onChange={(event) => {
                  setCode(event.target.value);
                  setWrong(false);
                }}
              />
            ) : (
              <OtpInput
                label="Sign-in code"
                value={code}
                invalid={wrong}
                onChange={(value) => {
                  setCode(value);
                  setWrong(false);
                }}
              />
            )}
          </>
        )}
        {problem !== null && <ErrorText>{problem}</ErrorText>}
        {factors.length > 1 && (
          <fieldset className="mt-[16px] border-none p-0">
            <legend className="mb-[8px] text-[11px] font-bold tracking-[.04em] text-slate uppercase">
              Use another way
            </legend>
            <div className="flex flex-col items-start gap-[8px]">
              {factors
                .filter((option) => option.id !== factor?.id)
                .map((option) => (
                  <Button key={option.id} type="button" variant="ghost" onClick={() => void choose(option)}>
                    {factorLabel(option)}
                  </Button>
                ))}
            </div>
          </fieldset>
        )}
      </form>
    </EntryFrame>
  );
}
