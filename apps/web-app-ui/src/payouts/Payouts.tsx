'use client';

import type { Payout, PayoutSummary } from '@komtru/api-client';
import { usePayoutSummary, usePayouts, useSetPayoutPreference } from '@komtru/api-client/react';
import { PAYOUT_MODES, type PayoutMode } from '@komtru/shared-types';
import {
  Button,
  EmptyState,
  LoadFailed,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  SectionLabel,
  Sheet,
  Skeleton,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { isProblem, nairaShort, whenLabel } from '../trade/format';
import { OverTabBar } from '../trade/parts';
import { MODE_COPY, accountLabel, payoutProblem, payoutStatus } from './format';
import { BANK_HREF, BankRow, WITHDRAW_HREF, payoutHref } from './parts';

/**
 * Seller-6: where "funds released" lands. The available balance and what is on its way are the platform's summary;
 * the history is `GET /me/payouts`, newest first. Withdraw opens AB5; Schedule opens the choice of how the seller is
 * paid, which the platform refuses for an automatic mode until there is a verified payout account.
 */
export function Payouts(): React.JSX.Element {
  const summary = usePayoutSummary();
  const [scheduling, setScheduling] = useState(false);

  if (summary.isPending) {
    return (
      <ScreenColumn>
        <Heading />
        <div role="status" aria-label="Loading your payouts" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </ScreenColumn>
    );
  }
  if (summary.isError) {
    return (
      <LoadFailed
        title="Couldn’t load your payouts"
        body="Check your connection and try again."
        onRetry={() => void summary.refetch()}
      />
    );
  }

  const data = summary.data;
  const canWithdraw = !data.held && BigInt(data.availableMinor) > 0n;

  return (
    <ScreenColumn>
      <Heading />
      {data.held && (
        <WarnBanner title="Payouts on your account are paused">
          Contact support to find out why. Nothing can be withdrawn until the pause is lifted.
        </WarnBanner>
      )}
      {/* `.balance-mini`. The gradient's far stop is the reference's literal `#1A2440`, which has no token. */}
      <section
        aria-label="Your balance"
        className="mb-[16px] rounded-lg bg-[linear-gradient(135deg,var(--komtru-midnight),rgb(26,36,64))] p-[18px] text-pure-white"
      >
        <p className="m-0 text-[10px] uppercase text-[rgba(255,255,255,.6)]">Available for withdrawal</p>
        <p className="mb-[14px] mt-[5px] font-mono text-[24px] font-semibold">
          {nairaShort(data.availableMinor)}
        </p>
        <div className="flex gap-[8px]">
          {canWithdraw ? (
            <Button asChild className="flex-1 bg-pure-white! text-komtru-midnight!">
              <a href={WITHDRAW_HREF}>Withdraw</a>
            </Button>
          ) : (
            <Button type="button" disabled className="flex-1 bg-pure-white! text-komtru-midnight!">
              Withdraw
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            className="flex-1 border-[rgba(255,255,255,.3)]! text-pure-white!"
            onClick={() => setScheduling(true)}
          >
            Schedule
          </Button>
        </div>
      </section>
      {BigInt(data.inFlightMinor) > 0n && (
        <p className="-mt-[6px] mb-[16px] text-[11.5px] text-slate">
          {nairaShort(data.inFlightMinor)} is on its way to your bank.
        </p>
      )}
      <PaidHow summary={data} />
      <History />
      <ScheduleSheet open={scheduling} current={data.mode} onClose={() => setScheduling(false)} />
    </ScreenColumn>
  );
}

function Heading(): React.JSX.Element {
  return <h1 className="mb-[16px] text-[19px] font-semibold">Payouts</h1>;
}

/** How the seller is paid and where it goes. The account row opens AB6. */
function PaidHow({ summary }: { summary: PayoutSummary }): React.JSX.Element {
  const account = summary.defaultAccount;
  return (
    <section aria-label="How you’re paid" className="mb-[8px]">
      <SectionLabel>Payout account</SectionLabel>
      {account === null ? (
        <NoteBanner>
          Add the bank account your money is paid into.{' '}
          <a href={BANK_HREF} className="font-semibold text-info-on-soft">
            Add a bank account
          </a>
        </NoteBanner>
      ) : (
        <a href={BANK_HREF} className="block text-midnight-text no-underline">
          <BankRow
            bankName={account.bankName}
            title={accountLabel(account)}
            sub={`${account.accountName ?? 'Verified by your bank'} · Paid ${MODE_COPY[summary.mode].label.toLowerCase()}`}
            trailing={<span className="text-[11px] font-semibold text-info-on-soft">Change</span>}
          />
        </a>
      )}
    </section>
  );
}

function History(): React.JSX.Element {
  const list = usePayouts();
  const payouts = (list.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <section aria-labelledby="recent-payouts">
      <SectionLabel>
        <span id="recent-payouts">Recent payouts</span>
      </SectionLabel>
      {list.isPending ? (
        <div role="status" aria-label="Loading your payouts" aria-busy="true">
          <Skeleton width="full" lines={2} />
        </div>
      ) : list.isError && list.data === undefined ? (
        <RiskBanner title="Your payouts didn’t load">
          <Button type="button" variant="ghost" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </RiskBanner>
      ) : payouts.length === 0 ? (
        <EmptyState
          title="No payouts yet"
          body="When you withdraw, or an automatic payout is sent, it’s listed here with its receipt."
        />
      ) : (
        <>
          <ul aria-label="Recent payouts" className="m-0 list-none p-0">
            {payouts.map((payout) => (
              <li key={payout.id}>
                <PayoutRow payout={payout} />
              </li>
            ))}
          </ul>
          {list.isFetchNextPageError && (
            <RiskBanner title="Older payouts didn’t load">
              <Button type="button" variant="ghost" onClick={() => void list.fetchNextPage()}>
                Try again
              </Button>
            </RiskBanner>
          )}
          {list.hasNextPage && !list.isFetchNextPageError && (
            <Button
              type="button"
              variant="secondary"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Show older payouts'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** `.listing-row-mini`: the account, when it was asked for (and how it ended, unless it arrived), the amount. */
function PayoutRow({ payout }: { payout: Payout }): React.JSX.Element {
  const status = payoutStatus(payout.status);
  const to = payout.destination === null ? 'Bank account' : accountLabel(payout.destination);
  const when = whenLabel(payout.requestedAt);
  return (
    <a
      href={payoutHref(payout.id)}
      className="mb-[8px] flex items-center gap-[10px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[10px] text-midnight-text no-underline"
    >
      <span>
        <span className="block text-[12.5px] font-semibold">{to}</span>
        <span className="mt-[1px] block text-[10.5px] text-slate">
          {payout.status === 'SUCCEEDED' ? when : `${when} · ${status.label}`}
        </span>
      </span>
      <span className="ml-auto font-mono text-[12.5px] font-semibold">{nairaShort(payout.amountMinor)}</span>
    </a>
  );
}

/** "Schedule": how the seller is paid. Radios, one per mode the platform offers, the current one chosen. */
function ScheduleSheet({
  open,
  current,
  onClose,
}: {
  open: boolean;
  current: PayoutMode;
  onClose: () => void;
}): React.JSX.Element {
  const save = useSetPayoutPreference();
  const [mode, setMode] = useState<PayoutMode>(current);
  const [problem, setProblem] = useState<{ text: string; needsAccount: boolean } | undefined>(undefined);
  const close = () => {
    setMode(current);
    setProblem(undefined);
    onClose();
  };
  const submit = () => {
    setProblem(undefined);
    save.mutate(mode, {
      onSuccess: onClose,
      onError: (error) =>
        setProblem({
          text: payoutProblem(error, 'schedule'),
          needsAccount: isProblem(error, 'PAYOUT_ACCOUNT_REQUIRED'),
        }),
    });
  };
  return (
    <OverTabBar>
      <Sheet
        open={open}
        onClose={close}
        title="How do you want to be paid?"
        footer={
          <>
            <Button type="button" disabled={save.isPending || mode === current} onClick={submit}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </>
        }
      >
        <fieldset className="mb-[14px] border-0 p-0">
          <legend className="sr-only">Payout schedule</legend>
          {PAYOUT_MODES.map((option) => (
            <label
              key={option}
              className={[
                'mb-[8px] flex cursor-pointer items-start gap-[10px] rounded-md border-[1.5px] border-solid p-[12px]',
                mode === option ? 'border-trust-indigo bg-trust-indigo-soft' : 'border-border-hairline',
              ].join(' ')}
            >
              <input
                type="radio"
                name="payout-mode"
                value={option}
                className="mt-[2px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
                checked={mode === option}
                onChange={() => setMode(option)}
              />
              <span>
                <b className="block text-[12.5px]">{MODE_COPY[option].label}</b>
                <span className="text-[11px] leading-[1.5] text-slate">{MODE_COPY[option].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {problem !== undefined && (
          <RiskBanner>
            {problem.text}
            {problem.needsAccount && (
              <>
                {' '}
                <a href={BANK_HREF} className="font-semibold">
                  Add a bank account
                </a>
              </>
            )}
          </RiskBanner>
        )}
      </Sheet>
    </OverTabBar>
  );
}
