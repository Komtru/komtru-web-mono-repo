'use client';

import { getLogisticsMe } from '@komtru/api-client';
import { useApiClient } from '@komtru/app-kit/react';
import { Banner, Button, TextField } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { appSpec } from '../app-config';
import { destinationFor, parkUrl } from '../auth/park';
import {
  NO_ACCESS_BODY,
  NO_ACCESS_TITLE,
  SEVERAL_BODY,
  SEVERAL_TITLE,
  UNAVAILABLE,
  defaultFactor,
  needsSend,
  sendCode,
  submitCode,
  submitPassword,
  usableFactors,
  type Challenge,
  type Factor,
} from '../auth/sign-in';
import { signOut } from '../shell/sign-out';

const FACTOR_NAMES: Record<Factor['type'], string> = {
  TOTP: 'authenticator app',
  SMS_OTP: 'text message',
  EMAIL_OTP: 'email',
  PASSKEY: 'passkey',
  RECOVERY_CODE: 'recovery code',
};

export interface SignInFormProps {
  next?: string | undefined;
  /** Set by middleware when a session of another scope was turned away. */
  wrongScope?: boolean;
}

/**
 * T-160. The ordinary Komtru sign-in — email or phone and password, and a second factor only when the
 * account has one — against `/auth/logistics/login`. It is also how an invitation is accepted: there
 * is no token and no separate page, a first sign-in is the acceptance (m2 §8).
 *
 * "Not attached to a logistics company" is its own state, never the wrong-password message: the
 * password may be entirely right.
 */
export function SignInForm({ next, wrongScope = false }: SignInFormProps): React.JSX.Element {
  const router = useRouter();
  const client = useApiClient();
  const headingId = useId();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [factor, setFactor] = useState<Factor | undefined>(undefined);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [several, setSeveral] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Signed in: find out whose portal this is, and send a Park Agent to the Park app. */
  const enter = async (): Promise<void> => {
    try {
      const me = await client.call(getLogisticsMe, {});
      const destination = destinationFor(me, next, appSpec.homePath, parkUrl());
      if (destination.kind === 'park') {
        await signOut();
        window.location.assign(destination.url);
        return;
      }
      router.replace(destination.path);
      router.refresh();
    } catch {
      setMessage(UNAVAILABLE);
      setBusy(false);
    }
  };

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
    setNoAccess(false);
    setSeveral(false);
    const result = await submitPassword({ identifier: identifier.trim(), password });
    switch (result.kind) {
      case 'session':
        setPassword('');
        await enter();
        return;
      case 'no-access':
        setNoAccess(true);
        break;
      case 'several-invitations':
        setSeveral(true);
        break;
      case 'error':
        setMessage(result.message);
        break;
      case 'challenge': {
        setPassword('');
        setChallenge(result.challenge);
        const first = defaultFactor(result.challenge.factors);
        if (first === undefined) setMessage('This account has no second factor this screen can use.');
        else await present(first, result.challenge.mfaToken);
        break;
      }
    }
    setBusy(false);
  };

  const onCode = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (challenge === null || factor === undefined) return;
    setBusy(true);
    setMessage(null);
    const result = await submitCode({ mfaToken: challenge.mfaToken, factorId: factor.id, code: code.trim() });
    if (result.kind === 'ok') {
      await enter();
      return;
    }
    if (result.kind === 'no-access') setNoAccess(true);
    else if (result.kind === 'several-invitations') setSeveral(true);
    else setMessage(result.message);
    setCode('');
    setBusy(false);
  };

  const startOver = (): void => {
    setChallenge(null);
    setFactor(undefined);
    setCode('');
    setMessage(null);
    setNoAccess(false);
    setSeveral(false);
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
          ? 'Use your Komtru account. If your company invited you, signing in here accepts the invitation.'
          : factor === undefined
            ? 'Your password was right.'
            : stepPrompt(factor, sentTo)}
      </p>

      {wrongScope && challenge === null && !noAccess && !several && (
        <Banner tone="warning">That session was for another Komtru app. Sign in again here.</Banner>
      )}
      {noAccess && (
        <Banner tone="warning" title={NO_ACCESS_TITLE}>
          {NO_ACCESS_BODY}
        </Banner>
      )}
      {several && (
        <Banner tone="warning" title={SEVERAL_TITLE}>
          {SEVERAL_BODY}
        </Banner>
      )}
      {message !== null && <Banner tone="risk">{message}</Banner>}

      {challenge === null ? (
        <form onSubmit={(event) => void onPassword(event)} noValidate>
          <TextField
            label="Email or phone"
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
            {busy ? 'Checking…' : 'Sign in'}
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
