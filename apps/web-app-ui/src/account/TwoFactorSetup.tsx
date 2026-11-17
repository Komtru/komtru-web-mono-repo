'use client';

import { useActivateTotp, useEnrolTotp } from '@komtru/api-client/react';
import {
  Button,
  OtpInput,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  NoteBanner,
} from '@komtru/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { BackupCodes } from './BackupCodes';
import { QrCode } from './QrCode';
import { Loading } from './states';
import { SECURITY_HREF } from './SecurityScreen';
import { accountProblem, groupedKey } from './words';

/**
 * TF1 then TF2, one screen. The seed is made when the screen opens and is shown only here: it is not in the query
 * cache, the URL or storage, and leaving the screen ends it (the platform leaves an unconfirmed factor inert). The
 * backup codes come back from the activation, once, and are the next view; there is no way back to them.
 *
 * The QR code is drawn in the browser from the `otpauth` URI. The typed key and the `otpauth` link stay beside it, for
 * the phone that is also the screen and for a person who cannot scan.
 */
export function TwoFactorSetup(): React.JSX.Element {
  const enrol = useEnrolTotp();
  const activate = useActivateTotp();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [codes, setCodes] = useState<string[] | null | undefined>(undefined);
  // StrictMode runs effects twice in development; an enrolment is a write, so it must not.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    enrol.mutate();
  }, [enrol]);

  if (codes !== undefined) {
    return (
      <ScreenColumn>
        {codes === null ? (
          <NoteBanner title="Two-factor is on">
            This is another way to confirm it’s you. Your backup codes from before still work.
          </NoteBanner>
        ) : (
          <BackupCodes codes={codes} onDone={() => window.location.assign(SECURITY_HREF)} />
        )}
        {codes === null && (
          <Button type="button" onClick={() => window.location.assign(SECURITY_HREF)}>
            Done
          </Button>
        )}
      </ScreenColumn>
    );
  }

  const seed = enrol.data;
  const submit = () => {
    if (seed === undefined || code.length !== 6) return;
    setProblem(undefined);
    activate.mutate(
      { factorId: seed.factorId, code },
      {
        onSuccess: (answer) => setCodes(answer.recoveryCodes),
        onError: (error) => {
          setCode('');
          setProblem(accountProblem(error, 'enable-factor'));
        },
      },
    );
  };

  return (
    <ScreenColumn>
      <ScreenHeader title="Two-Factor Setup" backHref={SECURITY_HREF} backLabel="Back to security" />
      {!enrol.isError && seed === undefined ? (
        <Loading label="Getting your setup key" />
      ) : seed === undefined ? (
        <RiskBanner title="We couldn’t start the setup">
          <Button type="button" variant="ghost" onClick={() => enrol.mutate()}>
            Try again
          </Button>
        </RiskBanner>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="mb-[16px] text-[12px] leading-[1.6] text-slate">
            Add this to Google Authenticator or any TOTP app — it adds a second check on top of your password
            at login.
          </p>
          <div className="mx-auto mb-[16px] flex h-[160px] w-[160px] items-center justify-center rounded-md border border-solid border-border-hairline bg-surface-primary">
            <QrCode value={seed.otpauthUri} label="QR code for your authenticator app" />
          </div>
          <SectionLabel>Can’t scan? Enter this code</SectionLabel>
          <p className="mb-[8px] rounded-sm border border-solid border-border-hairline bg-surface-primary p-[12px] text-center font-mono text-[13px] tracking-[.08em]">
            <span className="sr-only">Your setup key: </span>
            {groupedKey(seed.secret)}
          </p>
          <p className="mb-[16px] text-center text-[12px]">
            <a href={seed.otpauthUri} className="text-slate underline">
              Open in your authenticator app
            </a>
          </p>
          <SectionLabel>Enter the 6-digit code from your app</SectionLabel>
          <OtpInput label="6-digit code" value={code} onChange={setCode} invalid={problem !== undefined} />
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <Button type="submit" disabled={code.length !== 6 || activate.isPending}>
            {activate.isPending ? 'Checking…' : 'Verify & enable'}
          </Button>
        </form>
      )}
    </ScreenColumn>
  );
}
