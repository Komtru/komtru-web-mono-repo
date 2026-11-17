'use client';

import type { AccountDevice, AccountFactor, AccountSession } from '@komtru/api-client';
import {
  useDevices,
  useFactors,
  useRegenerateRecoveryCodes,
  useRemoveFactor,
  useRetireDevice,
  useRevokeSession,
  useSessions,
} from '@komtru/api-client/react';
import {
  Button,
  EmptyState,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SettingsGroup,
  SettingsRow,
  Toggle,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { ConfirmSheet } from '../trade/parts';
import { BackupCodes } from './BackupCodes';
import { Loading, LoadProblem } from './states';
import { StepUpSheet } from './StepUpSheet';
import { accountProblem, ago } from './words';

export const SECURITY_HREF = '/account/security';
export const TWO_FACTOR_HREF = '/account/security/two-factor';

const SECOND_FACTORS = new Set(['TOTP', 'SMS_OTP', 'PASSKEY']);
const FACTOR_NAME: Record<string, string> = {
  TOTP: 'Authenticator app',
  SMS_OTP: 'Text message codes',
  PASSKEY: 'Passkey',
};

/**
 * SP-M04: everything that protects the account in one place. Sign-in (two-step on or off), the methods behind it and
 * the backup codes, the devices the account has been used on, and signing out of every other one. The reference's
 * Password row and App lock are not here: the platform has no password-changed date to state, and an app lock belongs
 * to the phone apps, not a browser.
 */
export function SecurityScreen(): React.JSX.Element {
  const factors = useFactors();
  const devices = useDevices();
  const sessions = useSessions();

  const pending = factors.isPending || devices.isPending || sessions.isPending;
  const failed =
    (factors.data === undefined && factors.isError) ||
    (devices.data === undefined && devices.isError) ||
    (sessions.data === undefined && sessions.isError);

  return (
    <ScreenColumn>
      <ScreenHeader title="Security" backHref="/account" backLabel="Back to your account" />
      {pending ? (
        <Loading label="Loading your security settings" />
      ) : failed ||
        factors.data === undefined ||
        devices.data === undefined ||
        sessions.data === undefined ? (
        <LoadProblem
          what="your security settings"
          onRetry={() => {
            void factors.refetch();
            void devices.refetch();
            void sessions.refetch();
          }}
        />
      ) : (
        <Loaded factors={factors.data} devices={devices.data} sessions={sessions.data} />
      )}
    </ScreenColumn>
  );
}

function Loaded({
  factors,
  devices,
  sessions,
}: {
  factors: AccountFactor[];
  devices: AccountDevice[];
  sessions: AccountSession[];
}): React.JSX.Element {
  const methods = factors.filter((f) => SECOND_FACTORS.has(f.type));
  const sheet = factors.find((f) => f.type === 'RECOVERY_CODE');
  const on = methods.length > 0;

  return (
    <>
      <SettingsGroup label="Sign-in">
        <SettingsRow
          label="Two-step sign-in"
          sub={on ? 'On' : 'Off · add a second check on top of your password'}
          control={
            <Toggle
              label="Two-step sign-in"
              checked={on}
              // Switching on is the setup; switching off is removing the methods below, one at a time, each
              // with its own proof. A switch that quietly removed them all would be a way round that.
              locked={on}
              onChange={() => window.location.assign(TWO_FACTOR_HREF)}
            />
          }
        />
      </SettingsGroup>
      {on && <Methods methods={methods} sheet={sheet} factors={factors} />}
      <Devices devices={devices} sessions={sessions} />
      <p className="mt-[6px] text-[11.5px] leading-[1.6] text-trust-gray">
        Komtru will never ask for your PIN or a code. If someone does, it isn’t us.
      </p>
    </>
  );
}

function Methods({
  methods,
  sheet,
  factors,
}: {
  methods: AccountFactor[];
  sheet: AccountFactor | undefined;
  factors: AccountFactor[];
}): React.JSX.Element {
  const remove = useRemoveFactor();
  const regenerate = useRegenerateRecoveryCodes();
  const [removing, setRemoving] = useState<AccountFactor | undefined>(undefined);
  const [proving, setProving] = useState<'remove' | 'codes' | undefined>(undefined);
  const [codes, setCodes] = useState<string[] | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  if (codes !== undefined) {
    return <BackupCodes codes={codes} onDone={() => setCodes(undefined)} />;
  }

  const proved = (stepUpToken: string) => {
    const action = proving;
    setProving(undefined);
    if (action === 'remove' && removing !== undefined) {
      remove.mutate(
        { id: removing.id, stepUpToken },
        {
          onSuccess: () => setRemoving(undefined),
          onError: (error) => {
            setRemoving(undefined);
            setProblem(accountProblem(error, 'remove-factor'));
          },
        },
      );
    } else if (action === 'codes') {
      regenerate.mutate(stepUpToken, {
        onSuccess: (answer) => setCodes(answer.recoveryCodes),
        onError: (error) => setProblem(accountProblem(error, 'new-codes')),
      });
    }
  };

  return (
    <>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <SettingsGroup label="How you confirm it’s you">
        {methods.map((factor) => (
          <SettingsRow
            key={factor.id}
            label={FACTOR_NAME[factor.type] ?? factor.label}
            sub={
              factor.maskedDestination ??
              (factor.lastUsedAt === null ? 'Not used yet' : `Used ${ago(factor.lastUsedAt)}`)
            }
            control={
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setProblem(undefined);
                  setRemoving(factor);
                }}
              >
                Remove<span className="sr-only"> {FACTOR_NAME[factor.type] ?? factor.label}</span>
              </Button>
            }
          />
        ))}
        {sheet !== undefined && (
          <SettingsRow
            label="Backup codes"
            sub={`${String(sheet.remaining ?? 0)} left · each works once`}
            control={
              <Button
                type="button"
                variant="ghost"
                disabled={regenerate.isPending}
                onClick={() => {
                  setProblem(undefined);
                  setProving('codes');
                }}
              >
                {regenerate.isPending ? 'Working…' : 'Get new codes'}
              </Button>
            }
          />
        )}
      </SettingsGroup>
      <ConfirmSheet
        open={removing !== undefined && proving === undefined}
        title={`Remove ${removing === undefined ? 'this' : (FACTOR_NAME[removing.type] ?? removing.label)}?`}
        confirm="Continue"
        pending={remove.isPending}
        onConfirm={() => setProving('remove')}
        onClose={() => setRemoving(undefined)}
      >
        <p className="mb-[14px] text-center text-[12.5px] leading-[1.5] text-slate">
          {methods.length === 1
            ? 'Without it your account signs in with your password alone. We’ll ask you to confirm it’s you first.'
            : 'You’ll still have your other methods. We’ll ask you to confirm it’s you first.'}
        </p>
      </ConfirmSheet>
      <StepUpSheet
        open={proving !== undefined}
        factors={factors}
        onClose={() => {
          setProving(undefined);
          setRemoving(undefined);
        }}
        onProved={proved}
      />
    </>
  );
}

function Devices({
  devices,
  sessions,
}: {
  devices: AccountDevice[];
  sessions: AccountSession[];
}): React.JSX.Element {
  const retire = useRetireDevice();
  const revoke = useRevokeSession();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);

  const current = sessions.find((s) => s.current);
  const others = sessions.filter((s) => !s.current);
  const live = devices.filter((d) => d.status === 'ACTIVE');

  const signOutOthers = async () => {
    setProblem(undefined);
    setDone(false);
    try {
      for (const session of others) await revoke.mutateAsync(session.id);
      setDone(true);
    } catch (error) {
      setProblem(accountProblem(error, 'sign-out-device'));
    }
  };

  return (
    <>
      <SettingsGroup label="Trusted devices">
        {live.length === 0 ? (
          <div className="px-[14px] py-[12px]">
            <EmptyState
              title="No devices yet"
              body="Devices you sign in on will be listed here."
              className="border-0 py-[20px]"
            />
          </div>
        ) : (
          live.map((device) => {
            const here = current?.deviceId === device.id;
            return (
              <SettingsRow
                key={device.id}
                label={`${device.model ?? device.platform}${here ? ' · This device' : ''}`}
                sub={here ? 'Active now' : `Last used ${ago(device.lastSeenAt)}`}
                control={
                  here ? undefined : (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={retire.isPending}
                      onClick={() => {
                        setProblem(undefined);
                        retire.mutate(device.id, {
                          onError: (error) => setProblem(accountProblem(error, 'sign-out-device')),
                        });
                      }}
                    >
                      Remove<span className="sr-only"> {device.model ?? device.platform}</span>
                    </Button>
                  )
                }
              />
            );
          })
        )}
      </SettingsGroup>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <Button
        type="button"
        variant="secondary"
        disabled={others.length === 0 || revoke.isPending}
        onClick={() => void signOutOthers()}
      >
        {revoke.isPending ? 'Signing out…' : 'Sign out of other devices'}
      </Button>
      <p role="status" className="mt-[8px] text-[11.5px] leading-[1.6] text-trust-gray">
        {done
          ? 'Signed out everywhere else.'
          : others.length === 0
            ? 'You’re only signed in here.'
            : `Also signed in on ${String(others.length)} other ${others.length === 1 ? 'device' : 'devices'}.`}
      </p>
    </>
  );
}
