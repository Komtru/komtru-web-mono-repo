'use client';

import type { AccountFactor } from '@komtru/api-client';
import { useStepUp, useStepUpChallenge } from '@komtru/api-client/react';
import { Button, OtpInput, RiskBanner, Sheet, TextField } from '@komtru/ui-kit';
import { useState } from 'react';
import { OverTabBar } from '../trade/parts';
import { accountProblem } from './words';

/**
 * What proves it is you for a sensitive action (§S7): a code from a method already on the account, or the password for
 * an account that has none. A passkey cannot be used here yet, and an account that has only one is told so rather than
 * shown a box that cannot work. Recovery codes are not offered: they are for getting back in, not for this.
 */
export type StepUpProof =
  | { kind: 'totp'; factor: AccountFactor }
  | { kind: 'sms'; factor: AccountFactor }
  | { kind: 'password' }
  | { kind: 'unsupported' };

export function proofFor(factors: readonly AccountFactor[]): StepUpProof {
  const usable = factors.filter((f) => f.type === 'TOTP' || f.type === 'SMS_OTP');
  const totp = usable.find((f) => f.type === 'TOTP');
  if (totp !== undefined) return { kind: 'totp', factor: totp };
  const sms = usable.find((f) => f.type === 'SMS_OTP');
  if (sms !== undefined) return { kind: 'sms', factor: sms };
  // Only a recovery-code sheet or passkeys on the account: no password step-up is allowed once a factor exists.
  return factors.some((f) => f.type === 'PASSKEY') ? { kind: 'unsupported' } : { kind: 'password' };
}

/**
 * The sheet that asks. `onProved` gets the single-use token (five minutes, spent by the action it was asked for);
 * the caller sends it straight away and never keeps it.
 */
export function StepUpSheet({
  open,
  factors,
  title = 'Confirm it’s you',
  onClose,
  onProved,
}: {
  open: boolean;
  factors: readonly AccountFactor[];
  title?: string;
  onClose: () => void;
  onProved: (stepUpToken: string) => void;
}): React.JSX.Element {
  const proof = proofFor(factors);
  const stepUp = useStepUp();
  const challenge = useStepUpChallenge();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const close = () => {
    setCode('');
    setPassword('');
    setSent(false);
    setProblem(undefined);
    onClose();
  };

  const submit = () => {
    setProblem(undefined);
    const body =
      proof.kind === 'password'
        ? { password }
        : proof.kind === 'totp' || proof.kind === 'sms'
          ? { factorId: proof.factor.id, code }
          : undefined;
    if (body === undefined) return;
    stepUp.mutate(body, {
      onSuccess: ({ stepUpToken }) => {
        setCode('');
        setPassword('');
        setSent(false);
        onProved(stepUpToken);
      },
      onError: (error) => {
        setCode('');
        setProblem(accountProblem(error, 'step-up'));
      },
    });
  };

  const sendCode = () => {
    if (proof.kind !== 'sms') return;
    setProblem(undefined);
    challenge.mutate(proof.factor.id, {
      onSuccess: () => setSent(true),
      onError: (error) => setProblem(accountProblem(error, 'step-up')),
    });
  };

  const ready =
    proof.kind === 'password'
      ? password !== ''
      : (proof.kind === 'totp' || proof.kind === 'sms') && code.length === 6;

  return (
    <OverTabBar>
      <Sheet
        open={open}
        onClose={close}
        title={title}
        footer={
          <div className="mt-[14px] flex flex-col gap-[8px]">
            {proof.kind !== 'unsupported' && (
              <Button type="button" onClick={submit} disabled={!ready || stepUp.isPending}>
                {stepUp.isPending ? 'Checking…' : 'Confirm'}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        }
      >
        <div className="mt-[10px]">
          {proof.kind === 'totp' && (
            <>
              <p className="mb-[14px] text-center text-[12.5px] leading-[1.5] text-slate">
                Enter the 6-digit code from your authenticator app.
              </p>
              <OtpInput
                label="Authenticator code"
                value={code}
                onChange={setCode}
                invalid={problem !== undefined}
              />
            </>
          )}
          {proof.kind === 'sms' && (
            <>
              <p className="mb-[14px] text-center text-[12.5px] leading-[1.5] text-slate">
                {sent
                  ? `We sent a code to ${proof.factor.maskedDestination ?? 'your phone'}.`
                  : `We’ll text a code to ${proof.factor.maskedDestination ?? 'your phone'}.`}
              </p>
              {sent ? (
                <OtpInput
                  label="Text message code"
                  value={code}
                  onChange={setCode}
                  invalid={problem !== undefined}
                />
              ) : (
                <Button type="button" variant="secondary" onClick={sendCode} disabled={challenge.isPending}>
                  {challenge.isPending ? 'Sending…' : 'Send a code'}
                </Button>
              )}
            </>
          )}
          {proof.kind === 'password' && (
            <TextField
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
          {proof.kind === 'unsupported' && (
            <RiskBanner title="This needs a code">
              Your account uses a passkey, which this screen can’t use yet. Contact support to carry on.
            </RiskBanner>
          )}
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
        </div>
      </Sheet>
    </OverTabBar>
  );
}
