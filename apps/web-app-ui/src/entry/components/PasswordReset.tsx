'use client';

import { useApiClient } from '@komtru/app-kit/react';
import { changePassword, forgotPassword, ProblemError, resendOtp, resetPassword } from '@komtru/api-client';
import { Button, OtpInput, TextField } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { resetCode, type SentCode } from '../drafts';
import { checkNewPassword, ENTRY, failureMessage, MIN_PASSWORD_LENGTH, UNAVAILABLE } from '../flow';
import { proveCode } from '../session-calls';
import { EntryFrame, EntryHeading, ErrorText, Lede, ResendLine, useResendCountdown } from './EntryFrame';
import { useDraft } from './useDraft';

const limitedMessage = (error: ProblemError): string =>
  failureMessage({
    kind: 'limited',
    wait: error.retryAfterMs === undefined ? undefined : Math.ceil(error.retryAfterMs / 1000),
  });

/** Screen AC2 — behind E4's "Forgot password?". */
export function ForgotPasswordForm(): React.JSX.Element {
  const client = useApiClient();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (identifier.trim() === '') {
      setProblem('Enter the phone number on your account.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      // The same answer whether or not the number has an account (M1 §17): the next screen reads
      // the same either way, and only the real owner's phone gets a code.
      const sent = await client.call(forgotPassword, { body: { identifier: identifier.trim() } });
      resetCode.write({
        challengeId: sent.challengeId,
        destination: sent.maskedDestination,
        delivered: true,
        sentAt: Date.now(),
      });
      router.push(ENTRY.reset);
    } catch (error) {
      setBusy(false);
      setProblem(
        error instanceof ProblemError && error.status === 429
          ? limitedMessage(error)
          : error instanceof ProblemError && error.status === 422
            ? 'Enter the phone number on your account.'
            : UNAVAILABLE,
      );
    }
  };

  return (
    <EntryFrame
      title="Reset Password"
      back={ENTRY.login}
      footer={
        <Button type="submit" form="forgot-form" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset code'}
        </Button>
      }
    >
      <form id="forgot-form" onSubmit={(event) => void submit(event)} noValidate>
        <EntryHeading>What&apos;s your number?</EntryHeading>
        <Lede>
          We&apos;ll text a code to the phone number on your account — the same one your Trust Identity is
          anchored to.
        </Lede>
        <TextField
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="080X XXX XXXX"
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
          }}
        />
        {problem !== null && <ErrorText>{problem}</ErrorText>}
      </form>
    </EntryFrame>
  );
}

/** Screen AC3 — the code from AC2 and the new password, on one screen as the reference draws it. */
export function ResetPasswordForm(): React.JSX.Element {
  const client = useApiClient();
  const router = useRouter();
  const sent = useDraft(resetCode);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  /**
   * Kept once the code is proved. A password the platform refuses (too common, say) must not cost
   * the person their code: the token is good until it is spent, so a second try reuses it.
   */
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  /** The reset can no longer finish — the token is spent or the challenge is gone. Only AC2 helps. */
  const [expired, setExpired] = useState(false);
  const secondsLeft = useResendCountdown(sent?.sentAt);
  /** Set once the password is saved: forgetting the code then is the flow finishing, not a cold start. */
  const finished = useRef(false);

  const expire = () => {
    // Forget the dead challenge, but say why before sending the person back: a silent bounce to AC2
    // reads as the app losing their progress.
    finished.current = true;
    resetCode.clear();
    setExpired(true);
    setBusy(false);
  };

  useEffect(() => {
    if (sent === null && !finished.current) router.replace(ENTRY.forgot);
  }, [sent, router]);

  const resend = async () => {
    if (sent === null || sent === undefined || sending) return;
    setSending(true);
    try {
      const fresh = await client.call(resendOtp, { body: { challengeId: sent.challengeId } });
      const next: SentCode = { ...sent, challengeId: fresh.challengeId, sentAt: Date.now() };
      resetCode.write(next);
      setCode('');
      setWrong(false);
      setResetToken(null);
      setProblem(null);
    } catch (error) {
      if (error instanceof ProblemError && error.status === 422) {
        expire();
        return;
      }
      setProblem(
        error instanceof ProblemError && error.status === 429
          ? 'Too many codes requested. Wait a few minutes before asking for another.'
          : UNAVAILABLE,
      );
    } finally {
      setSending(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sent === null || sent === undefined || busy) return;
    const invalid = checkNewPassword(password, confirmation);
    setPasswordProblem(invalid);
    if (invalid !== null) return;
    if (resetToken === null && code.length !== 6) {
      setProblem('Enter the 6-digit code we sent.');
      return;
    }
    setBusy(true);
    setProblem(null);

    let token = resetToken;
    if (token === null) {
      const proved = await proveCode(sent.challengeId, code);
      if (proved.kind !== 'reset') {
        setBusy(false);
        if (proved.kind === 'wrong') {
          setWrong(true);
          setProblem(
            `That code doesn't match — check the SMS and try again. ${String(proved.attemptsRemaining)} attempt${proved.attemptsRemaining === 1 ? '' : 's'} left.`,
          );
        } else if (proved.kind === 'spent') {
          setWrong(true);
          setProblem("That code can't be used any more. Send a new code to carry on.");
        } else if (proved.kind === 'limited' || proved.kind === 'unavailable') {
          setProblem(failureMessage(proved));
        } else {
          setProblem(UNAVAILABLE);
        }
        return;
      }
      token = proved.resetToken;
      setResetToken(token);
    }

    try {
      await client.call(resetPassword, { body: { resetToken: token, newPassword: password } });
      finished.current = true;
      resetCode.clear();
      router.replace(`${ENTRY.login}?reset=done`);
    } catch (error) {
      setBusy(false);
      if (error instanceof ProblemError && error.status === 422) {
        const refused = error.problem.errors?.find((entry) => entry.path === 'newPassword');
        if (refused !== undefined) {
          setPasswordProblem(refused.message);
          return;
        }
        // Not the password: the token itself is spent or expired, and the challenge with it.
        expire();
        return;
      }
      setProblem(error instanceof ProblemError && error.status === 429 ? limitedMessage(error) : UNAVAILABLE);
    }
  };

  return (
    <EntryFrame
      title="New Password"
      back={ENTRY.forgot}
      footer={
        expired ? (
          <Button asChild>
            <a href={ENTRY.forgot}>Start again</a>
          </Button>
        ) : (
          <Button type="submit" form="reset-form" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </Button>
        )
      }
    >
      <form id="reset-form" onSubmit={(event) => void submit(event)} noValidate>
        <h1 className="sr-only">Set a new password</h1>
        {expired && <ErrorText>This reset has expired. Start again to get a new code.</ErrorText>}
        {resetToken === null && (
          <>
            <div className="mb-[4px]">
              <OtpInput
                label="Reset code"
                value={code}
                invalid={wrong}
                onChange={(value) => {
                  setCode(value);
                  setWrong(false);
                }}
              />
            </div>
            <ResendLine secondsLeft={secondsLeft} sending={sending} onResend={() => void resend()} />
          </>
        )}
        {problem !== null && <ErrorText>{problem}</ErrorText>}
        {passwordProblem !== null && <ErrorText>{passwordProblem}</ErrorText>}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${String(MIN_PASSWORD_LENGTH)} characters`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          invalid={passwordProblem !== null}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter password"
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
        />
      </form>
    </EntryFrame>
  );
}

/**
 * The phone path's first password (M1 §9.3): the platform opens the account on a proved number and
 * asks for a password next. The reference draws no screen for it; this is AC3's two fields without
 * the code, which the person has already given.
 */
export function SetPasswordForm({ next }: { next: string | undefined }): React.JSX.Element {
  const client = useApiClient();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const invalid = checkNewPassword(password, confirmation);
    setProblem(invalid);
    if (invalid !== null) return;
    setBusy(true);
    try {
      await client.call(changePassword, { body: { newPassword: password } });
      router.replace(next ?? '/');
    } catch (error) {
      setBusy(false);
      if (error instanceof ProblemError && error.status === 422) {
        // The account already has a password — this screen was revisited after it was set. There is
        // nothing to do here; changing a password is Account's job, with the current one.
        if (error.problem.errors?.some((entry) => entry.path === 'currentPassword') === true) {
          router.replace(next ?? '/');
          return;
        }
        setProblem(error.problem.errors?.[0]?.message ?? error.problem.detail ?? error.problem.title);
        return;
      }
      setProblem(error instanceof ProblemError && error.status === 429 ? limitedMessage(error) : UNAVAILABLE);
    }
  };

  return (
    <EntryFrame
      title="Create password"
      footer={
        <Button type="submit" form="set-password-form" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>
      }
    >
      <form id="set-password-form" onSubmit={(event) => void submit(event)} noValidate>
        <EntryHeading>Your number is verified</EntryHeading>
        <Lede>Now choose a password. You&apos;ll use it with your phone number to log in to Komtru.</Lede>
        {problem !== null && <ErrorText>{problem}</ErrorText>}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${String(MIN_PASSWORD_LENGTH)} characters`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          invalid={problem !== null}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter password"
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
        />
      </form>
    </EntryFrame>
  );
}
