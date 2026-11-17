'use client';

import { useRequestRecovery } from '@komtru/api-client/react';
import {
  Banner,
  Button,
  NoteBanner,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  TextField,
  VersionTimeline,
  type VersionStep,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { accountProblem } from './words';

const STEPS: VersionStep[] = [
  { id: 'old', title: 'Code to your current number', detail: 'Confirms it’s you', state: 'active' },
  { id: 'new', title: 'Code to your new number', detail: 'Confirms it’s yours', state: 'pending' },
  { id: 'tell', title: 'We tell your old number', detail: 'In case it wasn’t you', state: 'pending' },
];

/**
 * A Nigerian mobile number as people write it: `0803 221 4471`, `+234 803 221 4471`, `234…`. Enough to catch a typo before
 * it is sent; the platform is the one that decides whether a number is real.
 */
export function phoneDigits(value: string): string | undefined {
  const digits = value.replace(/[\s()-]/g, '').replace(/^\+/, '');
  return /^0\d{10}$/.test(digits) || /^234\d{10}$/.test(digits) ? digits : undefined;
}

/**
 * SP-M05. Your phone number is your Komtru ID, so a move is checked at both ends and the old number is told.
 *
 * What the platform can do today is only the last resort: there is no change-number route yet (no code to the old number,
 * no code to the new one, no notice to the old one), so the screen cannot honestly offer "Send a code" and says so. "I can't
 * get the code" is real: it opens the platform's recovery request for a lost phone, which a person on the team reviews with an
 * ID check. It is sent with the current number the person typed, because that is what the platform looks the account up by,
 * and it answers the same whether or not a number matches.
 */
export function ChangePhone(): React.JSX.Element {
  const recovery = useRequestRecovery();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const currentOk = phoneDigits(current) !== undefined;
  const nextOk = phoneDigits(next) !== undefined;
  const same = currentOk && nextOk && phoneDigits(current) === phoneDigits(next);

  const cantGetCode = () => {
    if (!currentOk) return;
    setProblem(undefined);
    recovery.mutate(
      { identifier: current.trim(), method: 'LOST_PHONE' },
      { onError: (error) => setProblem(accountProblem(error, 'step-up')) },
    );
  };

  return (
    <ScreenColumn>
      <ScreenHeader title="Change Number" backHref="/account/security" backLabel="Back to security" />
      <h2 className="mb-[3px] font-display text-[19px] font-semibold">Move to a new number</h2>
      <p className="mb-[16px] text-[12.5px] leading-[1.55] text-slate">
        Your phone number is how others find you on Komtru, so we check both numbers.
      </p>
      <TextField
        label="Current number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        mono={false}
        className="font-mono"
        value={current}
        invalid={current !== '' && !currentOk}
        helper={current !== '' && !currentOk ? 'Enter it the way you use it, like 0803 221 4471.' : undefined}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <TextField
        label="New number"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="080…"
        className="font-mono"
        value={next}
        invalid={(next !== '' && !nextOk) || same}
        helper={
          same
            ? 'That’s the number you already have.'
            : next !== '' && !nextOk
              ? 'Enter it the way you use it, like 0905 118 2290.'
              : undefined
        }
        onChange={(event) => setNext(event.target.value)}
      />
      <VersionTimeline steps={STEPS} aria-label="How the move works" className="my-[16px]" />
      <NoteBanner>
        No longer have your old SIM? Choose “I can’t get the code”. It takes up to 24 hours, with an ID check.
      </NoteBanner>
      <Banner tone="warning" title="Changing your number here isn’t available yet">
        We can’t send the two codes from this screen for now. If you can’t use your current number, ask for
        help below and we’ll check your ID.
      </Banner>
      {recovery.data !== undefined && (
        <ReadyBanner title="We’ve got your request">
          A person on the team will check your ID and come back to you within 24 hours.
        </ReadyBanner>
      )}
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <div className="mt-[16px] flex flex-col gap-[8px]">
        {/* Held back until the two codes can be sent: a button that looked live and did nothing would be a lie. */}
        <Button type="button" disabled aria-describedby="phone-unavailable">
          Send a code
        </Button>
        <span id="phone-unavailable" className="sr-only">
          Not available yet.
        </span>
        <Button
          type="button"
          variant="ghost"
          className="mx-auto mt-[4px] block text-center"
          disabled={!currentOk || recovery.isPending || recovery.data !== undefined}
          onClick={cantGetCode}
        >
          {recovery.isPending ? 'Sending…' : 'I can’t get the code'}
        </Button>
      </div>
    </ScreenColumn>
  );
}
