'use client';

import { CLOSE_REASON_CODES, type CloseReasonCode } from '@komtru/api-client';
import { useCloseAccount, useFactors, useMe, useRequestErasure } from '@komtru/api-client/react';
import {
  ActionStack,
  Banner,
  Button,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  Select,
  Sheet,
  StatusHero,
  TermList,
  TermRow,
  TextField,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { signOut } from '../entry/session-calls';
import { whenLabel, isProblem } from '../trade/format';
import { OverTabBar } from '../trade/parts';
import { Loading, LoadProblem } from './states';
import { StepUpSheet } from './StepUpSheet';
import { accountProblem, isActiveTradesRefusal } from './words';

const REASONS: Record<CloseReasonCode, string> = {
  NOT_USING: 'I’m not using Komtru any more',
  PRIVACY: 'I’m worried about my privacy',
  SECURITY: 'I’m worried about the security of my account',
  OTHER: 'Something else',
};

const ALERT_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

/**
 * CA1 and CA2. CA1 is the check: a trade still in progress blocks closing, and says so before the person has typed
 * anything. CA2 is the irreversible step: a sheet that says it cannot be undone, asks for the password, and holds the
 * button until the box is ticked. The same two screens serve "Delete my data" (`erase`): the platform's erasure request
 * closes the account first, then compliance decides what is deleted, so the person is told that plainly.
 *
 * `openTrades` is a yes or no from the platform, not a count, so the screen says "a Trade" and never draws the
 * reference's trade row. A `null` answer (the platform cannot say) does not block: the platform decides on submit and
 * its refusal is shown.
 */
export function CloseAccount({ erase = false }: { erase?: boolean }): React.JSX.Element {
  const me = useMe();
  const factors = useFactors();
  const close = useCloseAccount();
  const erasure = useRequestErasure();
  const [reason, setReason] = useState<CloseReasonCode>('OTHER');
  const [confirming, setConfirming] = useState(false);
  const [proving, setProving] = useState(false);
  const [sure, setSure] = useState(false);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState(false);
  const [done, setDone] = useState<{ scheduledFor?: string } | undefined>(undefined);

  const title = erase ? 'Delete My Data' : 'Close Account';

  if (done !== undefined) {
    return (
      <ScreenColumn>
        <StatusHero tone="success" title={erase ? 'Your request is in' : 'Your account is closed'}>
          {erase
            ? `Your account is closed. Your personal data will be erased by ${whenLabel(done.scheduledFor ?? '')}, except the records the law says we keep.`
            : 'You’ve been signed out everywhere. Your Trust History stays on record but is no longer visible to you.'}
        </StatusHero>
        <Button type="button" onClick={() => window.location.assign('/login')}>
          Back to sign in
        </Button>
      </ScreenColumn>
    );
  }

  if (me.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader title={title} backHref="/account/privacy" backLabel="Back to privacy and data" />
        <Loading label="Checking your account" />
      </ScreenColumn>
    );
  }
  if (me.data === undefined) {
    return <LoadProblem what="your account" onRetry={() => void me.refetch()} />;
  }

  const account = me.data.account;
  if (account.status === 'CLOSED' || account.status === 'ANONYMISED') {
    return (
      <ScreenColumn>
        <ScreenHeader title={title} backHref="/account" backLabel="Back to your account" />
        <Banner tone="info">This account is already closed.</Banner>
      </ScreenColumn>
    );
  }

  const hasOpenTrade = account.openTrades === true || blocked;

  const send = (proof: { password?: string; stepUpToken?: string }) => {
    setProblem(undefined);
    const body = { reason, ...proof };
    const options = {
      onSuccess: (answer: unknown) => {
        // Every session is gone on the platform's side; this clears this device's cookie and memory too.
        void signOut();
        setConfirming(false);
        setProving(false);
        setPassword('');
        setDone(erase ? { scheduledFor: (answer as { scheduledFor?: string }).scheduledFor } : {});
      },
      onError: (error: unknown) => {
        const typed = password;
        setPassword('');
        if (isActiveTradesRefusal(error)) {
          setConfirming(false);
          setBlocked(true);
          return;
        }
        if (isProblem(error, 'STEP_UP_REQUIRED')) {
          // An account with no password (it signs in by phone code) proves itself another way.
          setConfirming(false);
          setProving(true);
          return;
        }
        if (isProblem(error, 'VALIDATION_FAILED') && typed.trim() === '') {
          // The platform wants a password this account has: the field is not optional for it.
          setProblem('Enter your password to close your account.');
          return;
        }
        setProblem(accountProblem(error, erase ? 'erase' : 'close'));
      },
    };
    if (erase) erasure.mutate(body, options);
    else close.mutate(body, options);
  };

  const pending = close.isPending || erasure.isPending;

  return (
    <ScreenColumn>
      <ScreenHeader title={title} backHref="/account/privacy" backLabel="Back to privacy and data" />
      {hasOpenTrade ? (
        <>
          <Banner tone="warning" icon={ALERT_MARK} title="Can’t close with an active Trade">
            You have a Trade still in progress — finish or cancel it first.
          </Banner>
          <WhatStays />
          <ActionStack>
            <Button asChild variant="secondary">
              <a href="/trades">Resolve your active Trade first</a>
            </Button>
          </ActionStack>
        </>
      ) : (
        <>
          {erase && (
            <Banner tone="warning" icon={ALERT_MARK} title="This closes your account first">
              We close your account straight away, then erase your personal data. Some records are kept by
              law.
            </Banner>
          )}
          <WhatStays />
          <Select
            label="Why are you leaving? (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value as CloseReasonCode)}
          >
            {CLOSE_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {REASONS[code]}
              </option>
            ))}
          </Select>
          <ActionStack>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setProblem(undefined);
                setSure(false);
                setConfirming(true);
              }}
            >
              {erase ? 'Close and delete my data' : 'Close my account'}
            </Button>
          </ActionStack>
        </>
      )}
      <OverTabBar>
        <Sheet
          open={confirming}
          onClose={() => setConfirming(false)}
          title="This can’t be undone"
          footer={
            <div className="mt-[14px] flex flex-col gap-[8px]">
              <Button
                type="button"
                variant="danger"
                disabled={!sure || pending}
                onClick={() => send(password.trim() === '' ? {} : { password })}
              >
                {pending ? 'Closing…' : erase ? 'Close and delete my data' : 'Close my account'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          }
        >
          <p className="mb-[14px] text-center text-[12px] leading-[1.6] text-slate">
            You’ll lose access immediately — your Trust History stays on record but is no longer visible to
            you.
          </p>
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            helper="If you sign in with a code and have no password, leave this empty and we’ll ask for a code."
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label className="mb-[14px] flex items-start gap-[10px] text-[12.5px] leading-[1.5]">
            <input
              type="checkbox"
              className="mt-[3px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
              checked={sure}
              onChange={(event) => setSure(event.target.checked)}
            />
            <span>I understand this permanently closes my account.</span>
          </label>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
        </Sheet>
      </OverTabBar>
      <StepUpSheet
        open={proving}
        factors={factors.data ?? []}
        // This path is reached because the account has no password to give.
        allowPassword={false}
        onClose={() => setProving(false)}
        onProved={(stepUpToken) => send({ stepUpToken })}
      />
      {problem !== undefined && !confirming && <RiskBanner>{problem}</RiskBanner>}
    </ScreenColumn>
  );
}

/** "What stays, even after closing": the reference's three rows, which are the same whether or not the close is allowed. */
function WhatStays(): React.JSX.Element {
  return (
    <section aria-label="What stays, even after closing">
      <SectionLabel>What stays, even after closing</SectionLabel>
      <TermList>
        <TermRow label="Trust History">Preserved per regulatory requirement</TermRow>
        <TermRow label="Past Trade records">Kept, not visible to you</TermRow>
        <TermRow label="Phone number">Can’t be reused for 90 days</TermRow>
      </TermList>
    </section>
  );
}
