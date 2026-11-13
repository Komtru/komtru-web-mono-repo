'use client';

import type { PaymentStatus, PaystackInline, TradeView } from '@komtru/api-client';
import {
  paymentKey,
  tradeKeys,
  useConfirmPayment,
  useInitiatePayment,
  usePaymentStatus,
  useTrade,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  LoadFailed,
  LoadingScreen,
  NodeLoader,
  NoteBanner,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  StatusHero,
  TermList,
  TermRow,
  WarnBanner,
} from '@komtru/ui-kit';
import { isFundedTradeStatus } from '@komtru/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isProblem, naira, nairaShort, partyName, problemMessage, whenLabel } from '../format';
import { isRequestSpec } from '../create/request';
import { readRequest } from '../create/read';
import { ItemSummary } from '../parts';
import { channelsFor, paystackCheckout, type Checkout, type PayMethod } from './checkout';

export type { Checkout } from './checkout';

/** How often, and how many times, V3 reads the trade again while the platform moves it to FUNDED. */
export const TRADE_FOLLOW_MS = 3000;
const TRADE_FOLLOW_LIMIT = 10;

const tradeHref = (id: string) => `/trade/${id}`;

/**
 * F-024: the screens between "Fund this trade" and "funded". Which one shows is the platform's display state
 * for the payment (T-072), not the screen's own memory: V1 and V2 while nothing is paid, AB3 while the platform
 * verifies with Paystack (polled), AB4 when it could not confirm, V3 once the money is held. The only local
 * step is V1 → V2, because choosing a method costs nothing on the server.
 *
 * Every amount is the platform's: the trade's fee snapshot before an attempt exists, the attempt's own after.
 */
export function FundTrade({
  id,
  checkout = paystackCheckout,
  via,
}: {
  id: string;
  checkout?: Checkout;
  /** `?via=transfer`: open on V2, the reference's `/fund/transfer`. */
  via?: 'transfer';
}): React.JSX.Element {
  const trade = useTrade(id);
  const view = trade.data;
  const buyer = view?.yourRole === 'BUYER';
  const payable =
    view !== undefined && (view.status === 'PENDING_PAYMENT' || isFundedTradeStatus(view.status));
  // Read for the buyer whatever the trade's status: money can have arrived for a trade that has since ended.
  // A request the seller has not completed has nothing to fund yet, whatever its status says.
  const incomplete = view !== undefined && isRequestSpec(view.terms?.itemSpec);
  const payment = usePaymentStatus(id, buyer && !incomplete);

  if (incomplete) {
    return (
      <NothingToPay
        id={id}
        why="The seller hasn't confirmed the item details yet, so there is nothing to pay."
      />
    );
  }

  if (trade.isPending || (buyer && payment.isPending)) {
    return (
      <Frame title="Fund & Protect" back={tradeHref(id)}>
        <LoadingScreen label="Loading the payment" />
      </Frame>
    );
  }
  if (trade.isError) {
    return (
      <LoadFailed
        title="Couldn't open this trade"
        body={problemMessage(trade.error, 'Check your connection and try again.')}
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }
  if (!buyer) return <NothingToPay id={id} why="Only the buyer pays for a trade." />;
  if (payment.isError || payment.data === undefined) {
    return (
      <LoadFailed
        title="Couldn't read the payment"
        body={problemMessage(payment.error, 'Check your connection and try again.')}
        onRetry={() => void payment.refetch()}
      />
    );
  }
  if (!payable) {
    // Money the platform holds for a trade that is no longer waiting for it goes to the team (T-072 decision
    // 8, F-024's review signal); the buyer is told it is being checked, never that nothing was paid.
    const held = payment.data.displayState === 'CONFIRMED' || payment.data.displayState === 'UNDER_REVIEW';
    return held ? (
      <UnderReview trade={trade.data} />
    ) : (
      <NothingToPay id={id} why="This trade isn't waiting for payment." />
    );
  }
  return <Funding trade={trade.data} payment={payment.data} checkout={checkout} via={via} />;
}

function Funding({
  trade,
  payment,
  checkout,
  via,
}: {
  trade: TradeView;
  payment: PaymentStatus;
  checkout: Checkout;
  via: 'transfer' | undefined;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const initiate = useInitiatePayment(trade.id);
  const confirm = useConfirmPayment(trade.id);
  const [step, setStep] = useState<'choose' | 'review' | 'transfer'>(via ?? 'choose');
  const [method, setMethod] = useState<PayMethod>('transfer');
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const state = payment.displayState;
  const funded = isFundedTradeStatus(trade.status);

  // The money is held and the platform moves the trade to FUNDED moments later (the trades subscriber to the
  // ledger's event). Read the trade again until it has, a bounded number of times; the push does the rest.
  useEffect(() => {
    if (state !== 'CONFIRMED' || funded) return undefined;
    let reads = 0;
    const timer = setInterval(() => {
      reads += 1;
      if (reads > TRADE_FOLLOW_LIMIT) {
        clearInterval(timer);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id), exact: true });
    }, TRADE_FOLLOW_MS);
    return () => clearInterval(timer);
  }, [state, funded, queryClient, trade.id]);

  const onConfirm = () => {
    setProblem(undefined);
    confirm.mutate(undefined, {
      onError: (error) => setProblem(problemMessage(error, "We couldn't check the payment. Try again.")),
    });
  };

  // CWT-S05's "Check status": read the platform's own state again; nothing is asked of Paystack.
  const onCheckStatus = () => void queryClient.invalidateQueries({ queryKey: paymentKey(trade.id) });

  const openCheckout = (setup: PaystackInline) => {
    checkout
      .open(
        { ...setup, channels: channelsFor(method, setup.channels) },
        {
          onSuccess: onConfirm,
          onClose: () => setOpened(true),
          onError: () =>
            setProblem("Paystack couldn't take this payment. Try again, or choose another way to pay."),
        },
      )
      .catch(() => setProblem("Paystack's checkout didn't open. Check your connection and try again."));
  };

  const onPay = () => {
    setProblem(undefined);
    initiate.mutate(
      {},
      {
        onSuccess: (answer) => openCheckout(answer.inline),
        onError: (error) => {
          if (isProblem(error, 'CONFLICT')) {
            // Already paid for, or a payment in flight: re-read, and say so in case the status has not moved.
            void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id) });
            setProblem(
              "This trade has already been paid for, or a payment is in progress. We've reloaded where it stands.",
            );
            return;
          }
          setProblem(problemMessage(error, "We couldn't start the payment. Try again."));
        },
      },
    );
  };

  const onRestart = () => {
    setProblem(undefined);
    initiate.mutate(
      { restart: true },
      {
        onSuccess: () => {
          setStep('choose');
          setOpened(false);
        },
        onError: (error) => setProblem(problemMessage(error, "We couldn't start a new payment. Try again.")),
      },
    );
  };

  const busy = initiate.isPending || confirm.isPending;
  const notice = problem === undefined ? null : <RiskBanner>{problem}</RiskBanner>;

  if (state === 'CONFIRMED' || funded) {
    return <Protected trade={trade} payment={payment} funded={funded} />;
  }
  if (state === 'UNDER_REVIEW') return <UnderReview trade={trade} />;
  if (state === 'VERIFYING') {
    return <Verifying trade={trade} payment={payment} onCheck={onCheckStatus} />;
  }
  if (state === 'NOT_CONFIRMED') {
    return (
      <NotConfirmed
        trade={trade}
        payment={payment}
        notice={notice}
        busy={busy}
        onCheckAgain={onConfirm}
        onRestart={onRestart}
      />
    );
  }

  const fees = trade.fees;
  if (fees === null) return <NothingToPay id={trade.id} why="This trade has no agreed amount to pay yet." />;
  const total = payment.attempt?.amountMinor ?? fees.buyerTotalMinor;
  const deliveryCharge = readRequest(trade).deliveryChargeMinor;

  if (step === 'review') {
    const method_ = method === 'transfer' ? 'Bank transfer' : 'Debit card or USSD';
    return (
      <Frame
        title="Review Payment"
        back={tradeHref(trade.id)}
        onBack={() => setStep('choose')}
        backLabel="Back to payment methods"
      >
        <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
          Review the amount and funding method before leaving Komtru for payment processing.
        </p>
        <ItemSummary trade={trade} />
        <dl
          aria-label="What you pay"
          className="mb-[16px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px]"
        >
          <FeeRow label="Amount">{naira(fees.itemAmountMinor)}</FeeRow>
          <FeeRow label="Buyer Protection Fee">{naira(fees.buyerProtectionFeeMinor)}</FeeRow>
          <FeeRow label="Total" total>
            {naira(total)}
          </FeeRow>
        </dl>
        <TermList aria-label="Payment method">
          <TermRow label="Method">{method_}</TermRow>
        </TermList>
        <NoteBanner>
          Komtru moves the trade to Protected only after the payment provider confirms the transaction.
        </NoteBanner>
        {notice}
        <ActionStack>
          {method === 'transfer' ? (
            <Button type="button" onClick={() => setStep('transfer')}>
              Confirm &amp; pay
            </Button>
          ) : (
            <Button type="button" disabled={busy} onClick={onPay}>
              Confirm &amp; pay
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setStep('choose')}>
            Back
          </Button>
        </ActionStack>
      </Frame>
    );
  }

  if (step === 'transfer') {
    return (
      <Frame
        title="Bank Transfer"
        back={tradeHref(trade.id)}
        onBack={() => setStep('choose')}
        backLabel="Back to payment methods"
      >
        <div className="mb-[14px] rounded-lg bg-komtru-midnight p-[20px] text-pure-white">
          <p className="mb-[8px] text-[10px] uppercase tracking-[.08em] text-[rgba(255,255,255,.55)]">
            Transfer exactly
          </p>
          <p className="mb-[4px] font-mono text-[22px] font-semibold tracking-[.03em]">{naira(total)}</p>
          <p className="mb-0 mt-[12px] text-[12px] text-[rgba(255,255,255,.75)]">
            Paystack gives you an account number for this payment only. Send the exact amount from any banking
            app.
          </p>
        </div>
        <NoteBanner>
          The money never goes to the seller directly. Komtru holds it until you confirm delivery.
        </NoteBanner>
        {notice}
        <ActionStack>
          <Button type="button" disabled={busy} onClick={onPay}>
            Show account details
          </Button>
          {opened && (
            <Button type="button" variant="secondary" disabled={busy} onClick={onConfirm}>
              I have sent the funds
            </Button>
          )}
        </ActionStack>
      </Frame>
    );
  }

  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <dl
        aria-label="What you pay"
        className="mb-[16px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px]"
      >
        <FeeRow label="Trade reference">{trade.tradeCode}</FeeRow>
        <FeeRow label="Item price">{naira(fees.itemAmountMinor)}</FeeRow>
        <FeeRow label="Buyer Protection Fee">{naira(fees.buyerProtectionFeeMinor)}</FeeRow>
        <FeeRow label="Total to pay" total>
          {naira(fees.buyerTotalMinor)}
        </FeeRow>
      </dl>
      {deliveryCharge !== undefined && (
        <p className="-mt-[8px] mb-[16px] text-[11.5px] leading-[1.5] text-slate">
          The seller&apos;s delivery charge of {naira(deliveryCharge)} is paid to the seller outside Komtru
          protection and is not part of this total.
        </p>
      )}
      <fieldset className="m-0 border-0 p-0">
        <legend className="p-0">
          <SectionLabel as="p">Choose how to pay</SectionLabel>
        </legend>
        <PayMethodRow
          value="transfer"
          checked={method === 'transfer'}
          onChange={setMethod}
          title="Bank transfer"
          detail="A one-time account for this payment — pay from any banking app"
          icon={
            <>
              <rect height="12" rx="2.5" width="16" x="4" y="7" />
              <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
            </>
          }
        />
        <PayMethodRow
          value="card"
          checked={method === 'card'}
          onChange={setMethod}
          title="Debit card or USSD"
          detail="Instant, in Paystack's checkout"
          icon={
            <>
              <rect height="14" rx="2" width="18" x="3" y="5" />
              <path d="M3 10h18" />
            </>
          }
        />
      </fieldset>
      <NoteBanner>
        Your funds are protected for this trade. Seller payout stays locked until an authorised settlement
        outcome.
      </NoteBanner>
      {payment.attempt !== null && state === 'AWAITING_PAYMENT' && (
        <WarnBanner title="Awaiting provider confirmation">
          Keep this screen open or return to the trade. Do not dispatch while payment is pending.
        </WarnBanner>
      )}
      {notice}
      <ActionStack>
        <Button type="button" onClick={() => setStep('review')}>
          Continue to payment
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Cancel</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** CWT-S05 (and AB3): waiting is not the same as protected. The rows are the platform's own read of the attempt. */
function Verifying({
  trade,
  payment,
  onCheck,
}: {
  trade: TradeView;
  payment: PaymentStatus;
  onCheck: () => void;
}): React.JSX.Element {
  const attempt = payment.attempt;
  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <NodeLoader
        className="pt-[32px]"
        title="Verifying your payment"
        body="Do not close the flow. Komtru is waiting for payment confirmation. Checking with Paystack — usually under 30 seconds, occasionally up to 2 minutes on a busy network."
      />
      {attempt !== null && (
        <TermList aria-label="Payment" className="mt-[24px]">
          <TermRow label="Reference">{attempt.reference}</TermRow>
          <TermRow label="Amount">{naira(attempt.amountMinor)}</TermRow>
          <TermRow label="Provider status">Processing</TermRow>
          <TermRow label="Trade state">Awaiting confirmation</TermRow>
        </TermList>
      )}
      <p className="mt-[6px] text-[11.5px] leading-[1.6] text-trust-gray">
        This state is not the same as protected funds. The trade updates only after payment confirmation is
        received. You can leave this page; the trade updates as soon as the payment is confirmed.
      </p>
      <ActionStack>
        <Button type="button" onClick={onCheck}>
          Check status
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Return to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** CWT-S07 (and AB4): nothing is lost, the trade is waiting, and the ways forward. */
function NotConfirmed({
  trade,
  payment,
  notice,
  busy,
  onCheckAgain,
  onRestart,
}: {
  trade: TradeView;
  payment: PaymentStatus;
  notice: React.ReactNode;
  busy: boolean;
  onCheckAgain: () => void;
  onRestart: () => void;
}): React.JSX.Element {
  const attempt = payment.attempt;
  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <StatusHero tone="risk" as="h2" title="We couldn't confirm this payment">
        The provider did not confirm the payment. No protected-funds state has been created. We haven&apos;t
        seen the money arrive, and your trade is still waiting, untouched. If you sent a transfer, this is
        usually a bank delay, not a failed payment.
      </StatusHero>
      <SectionLabel>Payment</SectionLabel>
      <TermList aria-label="Payment">
        {attempt !== null && <TermRow label="Amount">{naira(attempt.amountMinor)}</TermRow>}
        {attempt !== null && <TermRow label="Reference">{attempt.reference}</TermRow>}
        <TermRow label="Status">Not confirmed</TermRow>
        <TermRow label="Trade">Awaiting funding</TermRow>
      </TermList>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        Do not dispatch. You can retry an eligible payment method or return to the trade. If you contact
        support, quote <span className="font-mono">{trade.tradeCode}</span>.
      </p>
      {notice}
      <ActionStack>
        <Button type="button" disabled={busy} onClick={onRestart}>
          Try payment again
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCheckAgain}>
          I&apos;ve sent it — check again
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Return to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** CWT-S06 (and V3): the money is held; the moment that unlocks the seller's dispatch. */
function Protected({
  trade,
  payment,
  funded,
}: {
  trade: TradeView;
  payment: PaymentStatus;
  funded: boolean;
}): React.JSX.Element {
  const attempt = payment.attempt;
  const amount = attempt?.amountMinor ?? trade.fees?.buyerTotalMinor;
  const seller = trade.counterparty ? partyName(trade.counterparty) : 'The seller';
  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <StatusHero tone="success" as="h2" title="Funds protected" className="pt-[32px]">
        {amount === undefined ? 'Your payment' : nairaShort(amount)} is now held in escrow.{' '}
        {funded
          ? `${seller} is told it's safe to dispatch.`
          : `${seller} will be told it's safe to dispatch as soon as the trade updates.`}
      </StatusHero>
      <TermList aria-label="Protected payment">
        {amount !== undefined && <TermRow label="Protected amount">{naira(amount)}</TermRow>}
        {attempt !== null && <TermRow label="Payment reference">{attempt.reference}</TermRow>}
        <TermRow label="Payment state">Protected</TermRow>
        <TermRow label="Seller payout">Held until settlement</TermRow>
      </TermList>
      {payment.displayState === 'UNDER_REVIEW' && (
        <NoteBanner>
          Another payment for this trade is being checked by our team. You don&apos;t need to pay again.
        </NoteBanner>
      )}
      {attempt !== null && attempt.displayState === 'CONFIRMED' && (
        <ReadyBanner
          title={attempt.confirmedAt === null ? 'Confirmed' : `Confirmed ${whenLabel(attempt.confirmedAt)}`}
        >
          Reference: {attempt.reference}
        </ReadyBanner>
      )}
      <ReadyBanner title="Dispatch is now eligible">
        This follows the trade state and fulfilment terms. Seller payout is still not released.
      </ReadyBanner>
      <ActionStack>
        <Button asChild>
          <a href={tradeHref(trade.id)}>View delivery</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={`${tradeHref(trade.id)}/activity`}>Back to trade timeline</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** Money arrived that did not match the attempt (T-072 decisions 2, 3, 10); the team settles it by hand. */
function UnderReview({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <StatusHero tone="warning" as="h2" title="We're checking this payment">
        We received a payment for this trade that our team needs to check before the trade can move on. You
        don&apos;t need to pay again.
      </StatusHero>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

function NothingToPay({ id, why }: { id: string; why: string }): React.JSX.Element {
  return (
    <Frame title="Fund & Protect" back={tradeHref(id)}>
      <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">{why}</p>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tradeHref(id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

function Frame({
  title,
  back,
  onBack,
  backLabel = 'Back to the trade',
  children,
}: {
  title: string;
  back: string;
  /** A step back inside this screen (V2 → V1) instead of leaving it. */
  onBack?: () => void;
  backLabel?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ScreenColumn>
      {onBack === undefined ? (
        <ScreenHeader title={title} backHref={back} backLabel={backLabel} />
      ) : (
        <ScreenHeader title={title} onBack={onBack} backLabel={backLabel} />
      )}
      {children}
    </ScreenColumn>
  );
}

/** `.fee-summary .fee-row`: label left, amount right; the total ruled off, in mono. */
function FeeRow({
  label,
  total = false,
  children,
}: {
  label: string;
  total?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={
        total
          ? 'mt-[4px] flex justify-between border-t border-solid border-border-hairline pt-[10px] text-[14px] font-bold text-midnight-text'
          : 'flex justify-between py-[6px] text-[12.5px] text-slate'
      }
    >
      <dt>{label}</dt>
      <dd className={total ? 'm-0 font-mono' : 'm-0'}>{children}</dd>
    </div>
  );
}

/** `.pay-method-row`: icon, title and line, radio on the right. A real radio, so the group is the browser's. */
function PayMethodRow({
  value,
  checked,
  onChange,
  title,
  detail,
  icon,
}: {
  value: PayMethod;
  checked: boolean;
  onChange: (value: PayMethod) => void;
  title: string;
  detail: string;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <label
      className={[
        'mb-[8px] flex cursor-pointer items-center gap-[12px] rounded-md border-[1.5px] border-solid p-[14px]',
        'has-[:focus-visible]:outline-[2.5px] has-[:focus-visible]:outline-offset-[2px] has-[:focus-visible]:outline-trust-indigo',
        checked ? 'border-trust-indigo bg-trust-indigo-soft' : 'border-border-hairline bg-surface-primary',
      ].join(' ')}
    >
      <span
        aria-hidden
        className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] bg-surface-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="h-[16px] w-[16px] stroke-midnight-text"
        >
          {icon}
        </svg>
      </span>
      <span>
        <b className="block text-[12.5px]">{title}</b>
        <span className="text-[10.5px] text-slate">{detail}</span>
      </span>
      <input
        type="radio"
        name="pay-method"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={[
          'relative ml-auto h-[16px] w-[16px] shrink-0 rounded-[50%] border-2 border-solid',
          checked
            ? "border-trust-indigo after:absolute after:inset-[3px] after:rounded-[50%] after:bg-trust-indigo after:content-['']"
            : 'border-border-hairline',
        ].join(' ')}
      />
    </label>
  );
}
