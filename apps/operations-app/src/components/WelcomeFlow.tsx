'use client';

import {
  acceptStaffInvitation,
  activateTotp,
  createApiClient,
  createTokenStore,
  enrolTotp,
  startStaffAcceptance,
  type ApiClient,
} from '@komtru/api-client';
import { publicEnv, readAppConfig } from '@komtru/app-kit';
import { Banner, Button, TextField } from '@komtru/ui-kit';
import { useRef, useState } from 'react';
import { appSpec } from '../app-config';
import { messageForError, stepLabel, stepsFor } from '../auth/welcome';
import { OnboardingTimeline } from './OnboardingTimeline';

type Phase =
  | { name: 'sign-in' }
  | { name: 'code'; challengeId: string }
  | { name: 'secure'; factorId: string; secret: string; otpauthUri: string }
  | { name: 'recovery'; codes: readonly string[] }
  | { name: 'done' };

const PANEL = 'rounded-md border border-solid border-border-hairline bg-surface-primary p-[20px]';

/**
 * OP-28, the new team member's first day, and the staff invitation acceptance that has no reference
 * screen of its own: the two live in one page because they happen in one sitting, signed in as the
 * same account.
 *
 * That account is a consumer one (T-038), so nothing here is a console session. The access token
 * comes from `/api/invitation/sign-in`, lives in this component's memory and dies with the tab. It
 * is what lets the invitee accept the invitation and set up the second factor that staff sign-in
 * will demand.
 */
export function WelcomeFlow({ token }: { token: string | undefined }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ name: 'sign-in' });
  const [pendingApproval, setPendingApproval] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = useRef<ApiClient | null>(null);

  const accepted = phase.name === 'secure' || phase.name === 'recovery' || phase.name === 'done';
  const secured = phase.name === 'recovery' || phase.name === 'done';
  const steps = stepsFor({ accepted, secured });

  const client = (accessToken: string): ApiClient => {
    const config = readAppConfig(appSpec, publicEnv());
    // No refresh: this token has no cookie behind it, so a 401 is the end of it.
    const tokens = createTokenStore({ refresh: () => Promise.resolve(null) });
    tokens.set({ accessToken, scope: 'CONSUMER' });
    return createApiClient({ baseUrl: config.apiUrl, tokens });
  };

  const guarded = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const signIn = (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    return guarded(async () => {
      if (token === undefined) return;
      const response = await fetch('/api/invitation/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        accessToken?: string;
        title?: string;
        detail?: string;
      };
      if (!response.ok || typeof body.accessToken !== 'string') {
        setMessage(
          response.status === 401
            ? 'That sign-in did not match. Check it and try again.'
            : [body.title, body.detail].filter(Boolean).join('. ') ||
                'Sign-in is unavailable right now. Try again in a moment.',
        );
        return;
      }
      setPassword('');
      api.current = client(body.accessToken);
      const started = await api.current.call(startStaffAcceptance, { body: { token } });
      setPhase({ name: 'code', challengeId: started.challengeId });
    });
  };

  const accept = (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    return guarded(async () => {
      if (token === undefined || api.current === null || phase.name !== 'code') return;
      const result = await api.current.call(acceptStaffInvitation, {
        body: { token, challengeId: phase.challengeId, code: code.trim() },
      });
      if (result.status === 'PENDING_APPROVAL') setPendingApproval(result.roleCode);
      setCode('');
      const enrolled = await api.current.call(enrolTotp, {});
      setPhase({ name: 'secure', ...enrolled });
    });
  };

  const turnOn = (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    return guarded(async () => {
      if (api.current === null || phase.name !== 'secure') return;
      const result = await api.current.call(activateTotp, {
        body: { factorId: phase.factorId, code: code.trim() },
      });
      setCode('');
      setPhase(
        result.recoveryCodes === null ? { name: 'done' } : { name: 'recovery', codes: result.recoveryCodes },
      );
    });
  };

  return (
    <div className="grid gap-[16px] md:grid-cols-[250px_minmax(0,1fr)]">
      <OnboardingTimeline steps={steps} />

      <div className="min-w-0">
        <h1 className="m-0 font-display text-[24px] leading-[1.15] font-semibold tracking-[-.01em]">
          {phase.name === 'sign-in' || phase.name === 'code'
            ? 'Accept your invitation'
            : 'Secure your account'}
        </h1>
        <p className="mt-[4px] mb-[18px] max-w-[620px] text-[12.5px] leading-[1.5] text-slate">
          {stepLabel(steps)} · takes about 3 minutes.
        </p>

        {message !== null && <Banner tone="risk">{message}</Banner>}

        {phase.name === 'sign-in' &&
          (token === undefined ? (
            <Banner tone="warning" title="Open the link in your invitation email">
              This page needs the invitation link you were sent. If it expired, ask your team lead to send a
              new one.
            </Banner>
          ) : (
            <form onSubmit={(event) => void signIn(event)} noValidate className={PANEL}>
              <h2 className="m-0 mb-[8px] text-[14px] font-semibold">Sign in to confirm it is you</h2>
              <p className="m-0 mb-[14px] text-[12px] leading-[1.6] text-slate">
                Use the Komtru account that has the email address the invitation was sent to.
              </p>
              <TextField
                label="Email, phone or username"
                name="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
              <TextField
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button type="submit" disabled={busy || identifier.trim() === '' || password === ''}>
                {busy ? 'Checking…' : 'Send me a code'}
              </Button>
            </form>
          ))}

        {phase.name === 'code' && (
          <form onSubmit={(event) => void accept(event)} noValidate className={PANEL}>
            <h2 className="m-0 mb-[8px] text-[14px] font-semibold">Enter the code we sent</h2>
            <p className="m-0 mb-[14px] text-[12px] leading-[1.6] text-slate">
              We sent a 6-digit code to the email address on the invitation.
            </p>
            <TextField
              label="6-digit code"
              name="code"
              mono
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button type="submit" disabled={busy || !/^\d{6}$/.test(code.trim())}>
              {busy ? 'Checking…' : 'Accept invitation'}
            </Button>
          </form>
        )}

        {phase.name === 'secure' && (
          <div className="grid items-start gap-[16px] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <form onSubmit={(event) => void turnOn(event)} noValidate className={PANEL}>
              <h2 className="m-0 mb-[8px] text-[14px] font-semibold">Two-step sign-in</h2>
              <p className="m-0 mb-[8px] text-[12.5px] leading-[1.5]">
                <b>1</b> Add this account to an authenticator app
              </p>
              <p className="m-0 mb-[4px] text-[11px] text-slate">Setup key</p>
              <code className="mb-[6px] block rounded-sm border border-solid border-border-hairline bg-surface-secondary p-[10px] font-mono text-[13px] tracking-[.06em] break-all">
                {phase.secret}
              </code>
              <a
                href={phase.otpauthUri}
                className="mb-[14px] inline-block text-[12px] text-info-on-soft underline"
              >
                Open in an authenticator app on this device
              </a>
              <p className="m-0 mb-[8px] text-[12.5px] leading-[1.5]">
                <b>2</b> Enter the code it shows
              </p>
              <TextField
                label="Enter the 6-digit code"
                name="code"
                mono
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button type="submit" className="w-auto px-[20px]" disabled={busy || code.trim() === ''}>
                {busy ? 'Checking…' : 'Turn on two-step sign-in'}
              </Button>
            </form>
            <aside className={PANEL} aria-label="Why we ask">
              <h2 className="m-0 mb-[8px] text-[14px] font-semibold">Why we ask</h2>
              <Banner tone="info">
                You can see people’s personal and financial details. Two-step sign-in makes sure it’s really
                you.
              </Banner>
              {pendingApproval !== null && (
                <Banner tone="warning" title="A second person has to approve your role">
                  The {pendingApproval} role needs a second approver. You can finish setting up now; the role
                  opens once they confirm.
                </Banner>
              )}
            </aside>
          </div>
        )}

        {phase.name === 'recovery' && (
          <div className={PANEL}>
            <h2 className="m-0 mb-[8px] text-[14px] font-semibold">Save your recovery codes</h2>
            <p className="m-0 mb-[12px] text-[12px] leading-[1.6] text-slate">
              Each code works once, if you lose your phone. They are shown only now.
            </p>
            <ul className="m-0 mb-[14px] grid list-none grid-cols-2 gap-[6px] p-0 font-mono text-[13px]">
              {phase.codes.map((recovery) => (
                <li key={recovery}>{recovery}</li>
              ))}
            </ul>
            <Button type="button" className="w-auto px-[20px]" onClick={() => setPhase({ name: 'done' })}>
              I have saved them
            </Button>
          </div>
        )}

        {phase.name === 'done' && (
          <div className={PANEL}>
            <Banner tone="success" title="Two-step sign-in is on">
              Your account is secured. Your access opens once the remaining steps are done and your team lead
              signs you off.
            </Banner>
            <Button asChild className="w-auto px-[20px]">
              <a href={appSpec.signInPath}>Go to sign-in</a>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
