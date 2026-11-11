'use client';

import { createIdempotencyKey, type PayoutAccount } from '@komtru/api-client';
import { usePayoutAccounts, usePayoutSummary, useRequestPayout } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  LoadFailed,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  WarnBanner,
  cx,
} from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { nairaShort } from '../trade/format';
import { accountLabel, isDecidedRefusal, koboToInput, parseNairaToKobo, payoutProblem } from './format';
import { BANK_HREF, BankRow, PAYOUTS_HREF, payoutHref } from './parts';

/** The reference's two quick amounts, in kobo. Offered only below the balance; "All" is the balance itself. */
const QUICK_AMOUNTS = ['5000000', '20000000'] as const;

/**
 * AB5: withdraw from the available balance to a verified account. The balance, the fee and every refusal are the
 * platform's; the screen only checks that what was typed is an amount and not more than the balance it was shown.
 * One withdrawal the seller asks for is one idempotency key, so a double tap or a retry after a lost answer is one
 * payout. The payout's own page follows it to the bank (PR1) or back (WF1).
 */
export function Withdraw(): React.JSX.Element {
  const summary = usePayoutSummary();
  const accounts = usePayoutAccounts();

  if (summary.isPending || accounts.isPending) {
    return (
      <Frame>
        <div role="status" aria-label="Loading your balance" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </Frame>
    );
  }
  if (summary.isError || accounts.isError) {
    return (
      <LoadFailed
        title="Couldn’t load your balance"
        body="Check your connection and try again."
        onRetry={() => {
          void summary.refetch();
          void accounts.refetch();
        }}
      />
    );
  }

  const verified = accounts.data
    .filter((account) => account.status === 'VERIFIED')
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  return (
    <WithdrawForm
      availableMinor={summary.data.availableMinor}
      feeMinor={summary.data.payoutFeeMinor}
      held={summary.data.held}
      accounts={verified}
    />
  );
}

function Frame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title="Withdraw" backHref={PAYOUTS_HREF} backLabel="Back to payouts" />
      {children}
    </ScreenColumn>
  );
}

function WithdrawForm({
  availableMinor,
  feeMinor,
  held,
  accounts,
}: {
  availableMinor: string;
  feeMinor: string;
  held: boolean;
  accounts: PayoutAccount[];
}): React.JSX.Element {
  const router = useRouter();
  const withdraw = useRequestPayout();
  const available = BigInt(availableMinor);
  const [text, setText] = useState(available > 0n ? koboToInput(availableMinor) : '');
  const [accountId, setAccountId] = useState(accounts[0]?.id);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // One key per withdrawal asked for: kept for a retry of the same amount to the same account, replaced otherwise.
  const attempt = useRef<{ key: string; for: string } | undefined>(undefined);

  const amountMinor = parseNairaToKobo(text);
  const amount = amountMinor === undefined ? undefined : BigInt(amountMinor);
  const tooMuch = amount !== undefined && amount > available;
  const valid = amount !== undefined && amount > 0n && !tooMuch;
  const account = accounts.find((candidate) => candidate.id === accountId);
  const ready = valid && account !== undefined && !held && !withdraw.isPending;

  const choose = (minor: string) => {
    setText(koboToInput(minor));
    setProblem(undefined);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || amountMinor === undefined) return;
    const intent = `${amountMinor}|${account.id}`;
    if (attempt.current?.for !== intent) attempt.current = { key: createIdempotencyKey(), for: intent };
    setProblem(undefined);
    withdraw.mutate(
      {
        body: { amountMinor, payoutAccountId: account.id },
        idempotencyKey: attempt.current.key,
      },
      {
        onSuccess: (payout) => router.push(payoutHref(payout.id)),
        onError: (error) => {
          // Only a definitive refusal ends this withdrawal; anything else may have reached the platform.
          if (isDecidedRefusal(error)) attempt.current = undefined;
          setProblem(payoutProblem(error, 'withdraw'));
        },
      },
    );
  };

  const allSelected = amountMinor === availableMinor;

  return (
    <Frame>
      {held && (
        <WarnBanner title="Payouts on your account are paused">Contact support to find out why.</WarnBanner>
      )}
      <form onSubmit={submit} noValidate>
        <div className="pb-[8px] pt-[20px] text-center">
          <label htmlFor="withdraw-amount" className="sr-only">
            Amount to withdraw, in naira
          </label>
          <span className="inline-flex items-start justify-center">
            <span aria-hidden className="mr-[2px] text-[16px] text-slate">
              ₦
            </span>
            <input
              id="withdraw-amount"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              placeholder="0"
              aria-invalid={tooMuch ? true : undefined}
              aria-describedby="withdraw-available"
              onChange={(event) => {
                setText(event.target.value);
                setProblem(undefined);
              }}
              className="w-[220px] max-w-full border-0 bg-transparent p-0 text-center font-mono text-[38px] font-semibold text-midnight-text outline-none focus-visible:outline-[2.5px] focus-visible:outline-offset-[2px] focus-visible:outline-trust-indigo"
            />
          </span>
          <p
            id="withdraw-available"
            className={cx('mt-[6px] text-[11px]', tooMuch ? 'text-risk' : 'text-trust-gray')}
          >
            {tooMuch ? 'That’s more than your available balance. ' : ''}Available:{' '}
            {nairaShort(availableMinor)}
          </p>
        </div>
        <div className="mb-[18px] flex gap-[8px]">
          {QUICK_AMOUNTS.filter((minor) => BigInt(minor) < available).map((minor) => (
            <QuickAmount
              key={minor}
              selected={amountMinor === minor}
              onClick={() => choose(minor)}
              label={nairaShort(minor)}
            />
          ))}
          {available > 0n && (
            <QuickAmount selected={allSelected} onClick={() => choose(availableMinor)} label="All" />
          )}
        </div>

        <SectionLabel as="p">To</SectionLabel>
        {accounts.length === 0 ? (
          <NoteBanner>
            Add a bank account your bank has verified to withdraw.{' '}
            <a href={BANK_HREF} className="font-semibold text-info-on-soft">
              Add a bank account
            </a>
          </NoteBanner>
        ) : accounts.length === 1 && account !== undefined ? (
          <BankRow
            bankName={account.bankName}
            title={accountLabel(account)}
            sub={account.accountName ?? undefined}
          />
        ) : (
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">Account to pay into</legend>
            {accounts.map((option) => (
              <label key={option.id} className="block cursor-pointer">
                <input
                  type="radio"
                  name="payout-account"
                  value={option.id}
                  checked={option.id === accountId}
                  onChange={() => setAccountId(option.id)}
                  className="peer sr-only"
                />
                <BankRow
                  bankName={option.bankName}
                  title={accountLabel(option)}
                  sub={[option.accountName, option.isDefault ? 'Your payout account' : null]
                    .filter(Boolean)
                    .join(' · ')}
                  selected={option.id === accountId}
                  className="peer-focus-visible:outline-[2.5px] peer-focus-visible:outline-offset-[2px] peer-focus-visible:outline-trust-indigo"
                />
              </label>
            ))}
          </fieldset>
        )}

        <NoteBanner>
          {BigInt(feeMinor) === 0n
            ? 'No payout fee is charged on this withdrawal. '
            : `A payout fee of ${nairaShort(feeMinor)} is taken from this amount. `}
          The money leaves your available balance now, and the receipt shows when it reaches your bank.
        </NoteBanner>
        {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
        <ActionStack>
          <Button type="submit" disabled={!ready}>
            {withdraw.isPending
              ? 'Sending…'
              : valid && amountMinor !== undefined
                ? `Withdraw ${nairaShort(amountMinor)}`
                : 'Withdraw'}
          </Button>
        </ActionStack>
      </form>
    </Frame>
  );
}

/** `.quick-amount-row button`: a pill that fills the amount; pressed while it is the amount shown. */
function QuickAmount({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'flex-1 cursor-pointer rounded-full border-[1.5px] border-solid p-[9px] text-[12px] font-semibold',
        'focus-visible:outline-[2.5px] focus-visible:outline-offset-[2px] focus-visible:outline-trust-indigo',
        selected
          ? 'border-trust-indigo bg-trust-indigo-soft text-info-on-soft'
          : 'border-border-hairline bg-surface-primary text-midnight-text',
      )}
    >
      {label}
    </button>
  );
}
