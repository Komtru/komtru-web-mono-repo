'use client';

import {
  useConfirmCurrentPhone,
  useFactors,
  useConfirmNewPhone,
  useRequestRecovery,
  useStartPhoneChange,
} from '@komtru/api-client/react';
import {
  Button,
  NoteBanner,
  OtpInput,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  TextField,
  VersionTimeline,
  type VersionStep,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { StepUpSheet } from './StepUpSheet';
import { accountProblem } from './words';

/**
 * A Nigerian mobile number as people write it: `0803 221 4471`, `+234 803 221 4471`, `234…`. Enough to catch a typo before
 * it is sent; the platform is the one that decides whether a number is real.
 */
export function phoneDigits(value: string): string | undefined {
  const digits = value.replace(/[\s()-]/g, '').replace(/^\+/, '');
  return /^0\d{10}$/.test(digits) || /^234\d{10}$/.test(digits) ? digits : undefined;
}

type Phase =
  | { at: 'enter' }
  | { at: 'current'; changeId: string; challengeId: string; sentTo: string }
  | { at: 'new'; changeId: string; challengeId: string; sentTo: string }
  | { at: 'done'; maskedPhone: string };

const stepsFor = (phase: Phase['at']): VersionStep[] => {
  const state = (index: number) => {
    const at = { enter: 0, current: 0, new: 1, done: 3 }[phase];
    return index < at ? ('done' as const) : index === at ? ('active' as const) : ('pending' as const);
  };
  return [
    { id: 'old', title: 'Code to your current number', detail: 'Confirms it’s you', state: state(0) },
    { id: 'new', title: 'Code to your new number', detail: 'Confirms it’s yours', state: state(1) },
    { id: 'tell', title: 'We tell your old number', detail: 'In case it wasn’t you', state: state(2) },
  ];
};

/**
 * SP-M05. Your phone number is your Komtru ID, so a move is checked at both ends and the old number is told: a code to the
 * current number (it is you), a code to the new one (it is yours), and then the platform changes the number and sends the
 * old one its notice. The platform holds the current number, so the person is never asked to type it.
 *
 * "I've lost access to my number" is a different thing and says so: it opens the platform's lost-phone recovery request,
 * which a person on the team answers after an ID check. That flow does not carry a new number, so it is not offered as a way to
 * make this change, only as the way back in when the old number is gone.
 */
export function ChangePhone(): React.JSX.Element {
  const start = useStartPhoneChange();
  const current = useConfirmCurrentPhone();
  const next = useConfirmNewPhone();
  const [phase, setPhase] = useState<Phase>({ at: 'enter' });
  const [newNumber, setNewNumber] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [proving, setProving] = useState(false);
  const factors = useFactors();

  const numberOk = phoneDigits(newNumber) !== undefined;
  const busy = start.isPending || current.isPending || next.isPending;

  /** §S7: a change of number asks for proof it is you first, from any method the account has; then the code goes out. */
  const send = (stepUpToken: string) => {
    if (!numberOk) return;
    setProblem(undefined);
    setProving(false);
    start.mutate(
      { newPhone: newNumber.trim(), stepUpToken },
      {
        onSuccess: (answer) => {
          if (!answer.delivered) {
            setProblem('We’ve sent too many codes to your current number recently. Try again later.');
            return;
          }
          setCode('');
          setPhase({
            at: 'current',
            changeId: answer.changeId,
            challengeId: answer.challengeId,
            sentTo: answer.maskedDestination,
          });
        },
        onError: (error) => setProblem(accountProblem(error, 'phone')),
      },
    );
  };

  const confirmCurrent = () => {
    if (phase.at !== 'current' || code.length !== 6) return;
    setProblem(undefined);
    current.mutate(
      { changeId: phase.changeId, challengeId: phase.challengeId, code },
      {
        onSuccess: (answer) => {
          setCode('');
          if (!answer.delivered) {
            // The code for the current number is spent; the change has to be started again.
            setPhase({ at: 'enter' });
            setProblem('We’ve sent too many codes to that new number recently. Try again later.');
            return;
          }
          setPhase({
            at: 'new',
            changeId: phase.changeId,
            challengeId: answer.challengeId,
            sentTo: answer.maskedDestination,
          });
        },
        onError: (error) => {
          setCode('');
          setProblem(accountProblem(error, 'phone'));
        },
      },
    );
  };

  const confirmNew = () => {
    if (phase.at !== 'new' || code.length !== 6) return;
    setProblem(undefined);
    next.mutate(
      { changeId: phase.changeId, challengeId: phase.challengeId, code },
      {
        onSuccess: (answer) => setPhase({ at: 'done', maskedPhone: answer.maskedPhone }),
        onError: (error) => {
          setCode('');
          setProblem(accountProblem(error, 'phone'));
        },
      },
    );
  };

  return (
    <ScreenColumn>
      <ScreenHeader title="Change Number" backHref="/account/security" backLabel="Back to security" />
      <h2 className="mb-[3px] font-display text-[19px] font-semibold">Move to a new number</h2>
      <p className="mb-[16px] text-[12.5px] leading-[1.55] text-slate">
        Your phone number is how others find you on Komtru, so we check both numbers.
      </p>

      {phase.at === 'enter' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (numberOk && factors.data !== undefined) setProving(true);
          }}
          noValidate
        >
          <TextField
            label="New number"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="080…"
            className="font-mono"
            value={newNumber}
            invalid={newNumber !== '' && !numberOk}
            helper={
              newNumber !== '' && !numberOk ? 'Enter it the way you use it, like 0905 118 2290.' : undefined
            }
            onChange={(event) => setNewNumber(event.target.value)}
          />
        </form>
      )}

      {(phase.at === 'current' || phase.at === 'new') && (
        <div>
          <p className="mb-[12px] text-[12.5px] leading-[1.55] text-slate">
            {phase.at === 'current'
              ? `We sent a code to your current number, ${phase.sentTo}. Enter it to confirm it’s you.`
              : `Now we sent a code to your new number, ${phase.sentTo}. Enter it to confirm it’s yours.`}
          </p>
          <OtpInput
            label={phase.at === 'current' ? 'Code from your current number' : 'Code from your new number'}
            value={code}
            onChange={setCode}
            invalid={problem !== undefined}
          />
        </div>
      )}

      <StepUpSheet
        open={proving}
        factors={factors.data ?? []}
        title="Confirm it’s you"
        onClose={() => setProving(false)}
        onProved={send}
      />

      {phase.at === 'done' && (
        <ReadyBanner title="Your number is changed">
          Your number is now {phase.maskedPhone}. We’ve told your old number. If you signed in with
          text-message codes, that method was switched off, and so were your printed backup codes if it was
          your only second factor: set them up again in Security.
        </ReadyBanner>
      )}

      <VersionTimeline steps={stepsFor(phase.at)} aria-label="How the move works" className="my-[16px]" />
      {phase.at !== 'done' && (
        <NoteBanner>
          No longer have your old SIM? Choose “I’ve lost access to my number” below. It takes up to 24 hours,
          with an ID check.
        </NoteBanner>
      )}
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}

      <div className="mt-[16px] flex flex-col gap-[8px]">
        {phase.at === 'enter' && (
          <Button
            type="button"
            disabled={!numberOk || busy || factors.data === undefined}
            onClick={() => setProving(true)}
          >
            {start.isPending ? 'Sending…' : 'Send a code'}
          </Button>
        )}
        {phase.at === 'current' && (
          <Button type="button" disabled={code.length !== 6 || busy} onClick={confirmCurrent}>
            {current.isPending ? 'Checking…' : 'Continue'}
          </Button>
        )}
        {phase.at === 'new' && (
          <Button type="button" disabled={code.length !== 6 || busy} onClick={confirmNew}>
            {next.isPending ? 'Changing…' : 'Change my number'}
          </Button>
        )}
        {phase.at === 'done' && (
          <Button type="button" onClick={() => window.location.assign('/account/security')}>
            Done
          </Button>
        )}
        {phase.at !== 'done' && <LostAccess />}
      </div>
    </ScreenColumn>
  );
}

/** The way back in when the old number is gone: the platform's lost-phone recovery request, with the number typed. */
function LostAccess(): React.JSX.Element {
  const recovery = useRequestRecovery();
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const ok = phoneDigits(identifier) !== undefined;

  if (recovery.data !== undefined) {
    return (
      <ReadyBanner title="We’ve got your request">
        A person on the team will check your ID and come back to you within 24 hours.
      </ReadyBanner>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        className="mx-auto mt-[4px] block text-center"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        I’ve lost access to my number
      </Button>
      {open && (
        <div className="mt-[10px]">
          <TextField
            label="The number you’ve lost"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            className="font-mono"
            value={identifier}
            helper="We’ll open a recovery request for this number. It doesn’t change your number: a person checks your ID first."
            onChange={(event) => setIdentifier(event.target.value)}
          />
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <Button
            type="button"
            variant="secondary"
            disabled={!ok || recovery.isPending}
            onClick={() => {
              setProblem(undefined);
              recovery.mutate(
                { identifier: identifier.trim(), method: 'LOST_PHONE' },
                { onError: (error) => setProblem(accountProblem(error, 'recovery')) },
              );
            }}
          >
            {recovery.isPending ? 'Sending…' : 'Ask for help getting back in'}
          </Button>
        </div>
      )}
    </div>
  );
}
