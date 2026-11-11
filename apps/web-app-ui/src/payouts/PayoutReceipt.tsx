'use client';

import type { Payout } from '@komtru/api-client';
import { usePayout, useTrade } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  Chip,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  StatusHero,
  TermList,
  TermRow,
  WarnBanner,
} from '@komtru/ui-kit';
import {
  isProblem,
  itemTitle,
  naira,
  nairaShort,
  partyName,
  problemMessage,
  whenLabel,
} from '../trade/format';
import { tabHref } from '../trade/workspace-state';
import { accountLabel, payoutStatus } from './format';
import { BANK_HREF, BankRow, PAYOUTS_HREF, WITHDRAW_HREF } from './parts';

/**
 * One payout, as the platform settled it: PR1's receipt once it is in the bank (or while it is on its way, polled),
 * WF1 when it failed or came back — the whole amount, fee included, is then back in the available balance — and a
 * plain "being checked" when the provider's answer did not match what was sent (NEEDS_REVIEW), which is neither.
 */
export function PayoutReceipt({ id }: { id: string }): React.JSX.Element {
  const query = usePayout(id);

  if (query.isPending) {
    return (
      <Frame>
        <LoadingScreen label="Loading the payout" />
      </Frame>
    );
  }
  // A failed poll keeps the payout already on screen.
  if (query.data === undefined) {
    const missing = isProblem(query.error, 'NOT_FOUND');
    return (
      <LoadFailed
        title={missing ? 'We can’t find that payout' : 'Couldn’t load this payout'}
        body={
          missing
            ? 'It may belong to another account.'
            : problemMessage(query.error, 'Check your connection and try again.')
        }
        {...(missing ? {} : { onRetry: () => void query.refetch() })}
      />
    );
  }

  const payout = query.data;
  if (payout.status === 'FAILED' || payout.status === 'REVERSED') return <Failed payout={payout} />;
  return <Receipt payout={payout} />;
}

function Frame({
  children,
  title = 'Payout',
}: {
  children: React.ReactNode;
  title?: string;
}): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title={title} backHref={PAYOUTS_HREF} backLabel="Back to payouts" />
      {children}
    </ScreenColumn>
  );
}

/** PR1. The hero is what the bank is sent; the details carry what left the balance and the frozen fee. */
function Receipt({ payout }: { payout: Payout }): React.JSX.Element {
  const status = payoutStatus(payout.status);
  return (
    <Frame title="Payout receipt">
      <div className="pb-[24px] pt-[20px] text-center">
        <p className="m-0 font-mono text-[26px] font-semibold">{naira(payout.transferAmountMinor)}</p>
        <Chip tone={status.tone} className="mt-[8px]">
          {status.label}
        </Chip>
      </div>
      {payout.status === 'NEEDS_REVIEW' && (
        <WarnBanner title="Our team is checking this payout">
          The bank’s answer didn’t match what was sent, so a person is looking at it. If you contact support,
          quote the reference below.
        </WarnBanner>
      )}
      {(payout.status === 'REQUESTED' || payout.status === 'PROCESSING') && (
        <NoteBanner>This page updates when your bank confirms the payout.</NoteBanner>
      )}
      <SectionLabel>Details</SectionLabel>
      <TermList aria-label="Payout details">
        <TermRow label="To">
          {payout.destination === null ? 'Bank account' : accountLabel(payout.destination)}
        </TermRow>
        {payout.destination !== null && payout.destination.accountName !== null && (
          <TermRow label="Name">{payout.destination.accountName}</TermRow>
        )}
        <TermRow label="From your balance">{naira(payout.amountMinor)}</TermRow>
        <TermRow label="Payout fee">{naira(payout.feeMinor)}</TermRow>
        <TermRow label="Reference">
          <span className="break-all font-mono text-[11px]">{payout.reference}</span>
        </TermRow>
        <TermRow label="Initiated">{whenLabel(payout.requestedAt)}</TermRow>
        {payout.status === 'SUCCEEDED' && payout.completedAt !== null && (
          <TermRow label="Arrived">{whenLabel(payout.completedAt)}</TermRow>
        )}
      </TermList>
      {payout.sourceTradeId !== null && <FromTrade tradeId={payout.sourceTradeId} />}
    </Frame>
  );
}

/** PR1's "From Trade": the sale whose proceeds an automatic payout sent. Read from the trade itself. */
function FromTrade({ tradeId }: { tradeId: string }): React.JSX.Element {
  const trade = useTrade(tradeId);
  const view = trade.data;
  const title = view?.terms ? itemTitle(view.terms.itemSpec, 'Trade') : 'The trade this paid out';
  const sub =
    view === undefined
      ? undefined
      : [view.tradeCode, view.counterparty ? partyName(view.counterparty) : undefined]
          .filter(Boolean)
          .join(' · ');
  return (
    <section aria-label="From trade">
      <SectionLabel>From trade</SectionLabel>
      <a
        href={tabHref(tradeId, 'overview')}
        className="mb-[8px] flex items-center gap-[10px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[10px] text-midnight-text no-underline"
      >
        <span
          aria-hidden
          className="h-[40px] w-[40px] shrink-0 rounded-[8px] bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]"
        />
        <span>
          <span className="block text-[12.5px] font-semibold">{title}</span>
          {sub !== undefined && <span className="mt-[1px] block text-[10.5px] text-slate">{sub}</span>}
        </span>
      </a>
    </section>
  );
}

/** WF1. Nothing was lost: the platform has put the whole amount back in the available balance. */
function Failed({ payout }: { payout: Payout }): React.JSX.Element {
  const returned = payout.status === 'REVERSED';
  return (
    <Frame>
      <StatusHero
        tone="risk"
        as="h2"
        title={returned ? 'This payout came back' : 'This withdrawal didn’t go through'}
        className="pt-[40px]"
      >
        {nairaShort(payout.amountMinor)} is back in your available balance — nothing was lost, and you can try
        again.
      </StatusHero>
      {payout.destination !== null && (
        <BankRow
          bankName={payout.destination.bankName}
          title={accountLabel(payout.destination)}
          sub={payout.failureReason ?? 'Your bank didn’t accept this payout.'}
          risk
        />
      )}
      <NoteBanner>
        If this keeps happening, try a different bank account or contact your bank directly — Komtru only
        relays what the bank reports back.
      </NoteBanner>
      <p className="mb-[14px] text-center text-[11.5px] text-trust-gray">
        If you contact support, quote <span className="font-mono">{payout.reference}</span>.
      </p>
      <ActionStack>
        <Button asChild>
          <a href={WITHDRAW_HREF}>Try again</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={BANK_HREF}>Use a different account</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
