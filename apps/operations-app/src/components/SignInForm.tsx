'use client';

import { Banner, Button, TextField } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import {
  defaultFactor,
  needsSend,
  safeNext,
  sendCode,
  submitCode,
  submitPassword,
  usableFactors,
  type Challenge,
  type Factor,
} from '../auth/sign-in';
import { appSpec } from '../app-config';

const FACTOR_NAMES: Record<Factor['type'], string> = {
  TOTP: 'authenticator app',
  SMS_OTP: 'text message',
  EMAIL_OTP: 'email',
  PASSKEY: 'passkey',
  RECOVERY_CODE: 'recovery code',
};

export interface SignInFormProps {
  /** Where to go once signed in. Already checked by the page, and checked again here. */
  next?: string | undefined;
  /** Set by middleware when a session of another scope was turned away. */
  wrongScope?: boolean;
}

/**
 * Staff sign-in, in the two steps the platform has: a password buys a challenge, and only a second
 * factor opens a session. There is no way to skip the second step and no "remember me": a console
 * that shows people's personal and financial details asks every time.
 */
export function SignInForm({ next, wrongScope = false }: SignInFormProps): React.JSX.Element {
  const router = useRouter();
  const headingId = useId();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [factor, setFactor] = useState<Factor | undefined>(undefined);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const present = async (chosen: Factor, token: string): Promise<void> => {
    setFactor(chosen);
    setCode('');
    setSentTo(null);
    if (!needsSend(chosen)) return;
    const sent = await sendCode({ mfaToken: token, factorId: chosen.id });
    if (sent.kind === 'sent') setSentTo(sent.destination);
    else setMessage(sent.message);
  };

  const onPassword = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await submitPassword({ identifier: identifier.trim(), password });
    if (result.kind === 'error') {
      setMessage(result.message);
    } else {
      // The password is not kept once it has bought a challenge.
      setPassword('');
      setChallenge(result.challenge);
      const first = defaultFactor(result.challenge.factors);
      if (first === undefined) {
        setMessage('This account has no second factor this screen can use. Ask your team lead for help.');
      } else {
        await present(first, result.challenge.mfaToken);
      }
    }
    setBusy(false);
  };

  const onCode = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (challenge === null || factor === undefined) return;
    setBusy(true);
    setMessage(null);
    const result = await submitCode({
      mfaToken: challenge.mfaToken,
      factorId: factor.id,
      code: code.trim(),
    });
    if (result.kind === 'ok') {
      router.replace(safeNext(next) ?? appSpec.homePath);
      router.refresh();
      return;
    }
    setMessage(result.message);
    setCode('');
    setBusy(false);
  };

  const startOver = (): void => {
    setChallenge(null);
    setFactor(undefined);
    setCode('');
    setMessage(null);
  };

  const others =
    challenge === null ? [] : usableFactors(challenge.factors).filter((f) => f.id !== factor?.id);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-solid border-border-hairline bg-surface-primary p-[24px]"
    >
      <h1 id={headingId} className="m-0 mb-[4px] font-display text-[22px] font-semibold leading-[1.2]">
        {challenge === null ? 'Sign in' : 'Two-step sign-in'}
      </h1>
      <p className="m-0 mb-[18px] text-[12.5px] leading-[1.5] text-slate">
        {challenge === null
          ? 'The Komtru team console. Use the account your invitation was sent to.'
          : factor === undefined
            ? 'Your password was right.'
            : stepPrompt(factor, sentTo)}
      </p>

      {wrongScope && challenge === null && (
        <Banner tone="warning">That account is not a team account, so it cannot use the console.</Banner>
      )}
      {message !== null && <Banner tone="risk">{message}</Banner>}

      {challenge === null ? (
        <form onSubmit={(event) => void onPassword(event)} noValidate>
          <TextField
            label="Email, phone or username"
            name="identifier"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Button type="submit" disabled={busy || identifier.trim() === '' || password === ''}>
            {busy ? 'Checking…' : 'Continue'}
          </Button>
        </form>
      ) : (
        factor !== undefined && (
          <form onSubmit={(event) => void onCode(event)} noValidate>
            <TextField
              label={factor.type === 'RECOVERY_CODE' ? 'Recovery code' : '6-digit code'}
              name="code"
              mono={factor.type !== 'RECOVERY_CODE'}
              inputMode={factor.type === 'RECOVERY_CODE' ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <Button type="submit" disabled={busy || code.trim() === ''}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
          </form>
        )
      )}

      {challenge !== null && (
        <div className="mt-[14px] flex flex-wrap items-center gap-[14px]">
          {others.map((other) => (
            <Button
              key={other.id}
              type="button"
              variant="ghost"
              onClick={() => void present(other, challenge.mfaToken)}
            >
              Use {FACTOR_NAMES[other.type]} instead
            </Button>
          ))}
          <Button type="button" variant="ghost" onClick={startOver}>
            Start over
          </Button>
        </div>
      )}
    </section>
  );
}

function stepPrompt(factor: Factor, sentTo: string | null): string {
  switch (factor.type) {
    case 'TOTP':
      return 'Enter the code from your authenticator app.';
    case 'SMS_OTP':
    case 'EMAIL_OTP':
      return sentTo === null ? 'We are sending you a code.' : `We sent a code to ${sentTo}.`;
    case 'RECOVERY_CODE':
      return 'Enter one of your recovery codes. Each works once.';
    default:
      return 'Enter your code.';
  }
}
