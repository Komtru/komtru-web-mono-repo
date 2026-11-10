'use client';

import type { PaymentStatus, PaystackInline, TradeView } from '@komtru/api-client';
import {
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
} from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isProblem, naira, nairaShort, partyName, problemMessage, whenLabel } from '../format';
import { channelsFor, paystackCheckout, type Checkout, type PayMethod } from './checkout';

export type { Checkout } from './checkout';

/** Every status a trade can be in once its escrow is funded. */
const FUNDED_OR_LATER = new Set([
  'FUNDED',
  'SHIPPED',
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'DISPUTED',
  'COMPLETED',
  'SETTLED',
  'RESOLVED_REFUNDED',
  'RESOLVED_RELEASED',
  'CANCELLED_REFUNDED',
]);

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
}: {
  id: string;
  checkout?: Checkout;
}): React.JSX.Element {
  const trade = useTrade(id);
  const view = trade.data;
  const buyer = view?.yourRole === 'BUYER';
  const payable =
    view !== undefined && (view.status === 'PENDING_PAYMENT' || FUNDED_OR_LATER.has(view.status));
  const payment = usePaymentStatus(id, buyer && payable);

  if (trade.isPending || (buyer && payable && payment.isPending)) {
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
  if (!payable) return <NothingToPay id={id} why="This trade isn't waiting for payment." />;
  if (payment.isError || payment.data === undefined) {
    return (
      <LoadFailed
        title="Couldn't read the payment"
        body={problemMessage(payment.error, 'Check your connection and try again.')}
        onRetry={() => void payment.refetch()}
      />
    );
  }
  return <Funding trade={trade.data} payment={payment.data} checkout={checkout} />;
}

function Funding({
  trade,
  payment,
  checkout,
}: {
  trade: TradeView;
  payment: PaymentStatus;
  checkout: Checkout;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const initiate = useInitiatePayment(trade.id);
  const confirm = useConfirmPayment(trade.id);
  const [step, setStep] = useState<'choose' | 'transfer'>('choose');
  const [method, setMethod] = useState<PayMethod>('transfer');
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const state = payment.displayState;
  const funded = FUNDED_OR_LATER.has(trade.status);

  // The money is held: the trade follows on the platform (PENDING_PAYMENT → FUNDED), so read it again.
  useEffect(() => {
    if (state === 'CONFIRMED' && !funded) {
      void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id), exact: true });
    }
  }, [state, funded, queryClient, trade.id]);

  const onConfirm = () => {
    setProblem(undefined);
    confirm.mutate(undefined, {
      onError: (error) => setProblem(problemMessage(error, "We couldn't check the payment. Try again.")),
    });
  };

  const openCheckout = (setup: PaystackInline) => {
    checkout
      .open(
        { ...setup, channels: channelsFor(method, setup.channels) },
        { onSuccess: onConfirm, onClose: () => setOpened(true) },
      )
      .then(() => setOpened(true))
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
            // Already paid for: the status says so, and the screen follows it.
            void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id) });
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

  if (state === 'CONFIRMED' || funded) return <Protected trade={trade} payment={payment} />;
  if (state === 'UNDER_REVIEW') return <UnderReview trade={trade} />;
  if (state === 'VERIFYING') return <Verifying trade={trade} />;
  if (state === 'NOT_CONFIRMED') {
    return (
      <NotConfirmed
        trade={trade}
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

  if (step === 'transfer') {
    return (
      <Frame title="Bank Transfer" back={`${tradeHref(trade.id)}/fund`} backLabel="Back to payment methods">
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
        <FeeRow label="Item price">{naira(fees.itemAmountMinor)}</FeeRow>
        <FeeRow label="Buyer Protection Fee">{naira(fees.buyerProtectionFeeMinor)}</FeeRow>
        <FeeRow label="Total to pay" total>
          {naira(fees.buyerTotalMinor)}
        </FeeRow>
      </dl>
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
      {notice}
      <ActionStack>
        {method === 'transfer' ? (
          <Button type="button" onClick={() => setStep('transfer')}>
            Continue with bank transfer
          </Button>
        ) : (
          <Button type="button" disabled={busy} onClick={onPay}>
            Continue with card or USSD
          </Button>
        )}
      </ActionStack>
    </Frame>
  );
}

/** AB3: the node pulse and skeleton, saying what is being waited on and roughly how long. */
function Verifying({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <NodeLoader
        className="pt-[32px]"
        title="Confirming your payment"
        body="Checking with Paystack — usually under 30 seconds, occasionally up to 2 minutes on a busy network."
      />
      <div aria-hidden className="mt-[28px]">
        <Skeleton width="w80" className="h-[16px]" />
        <Skeleton width="w60" className="h-[16px]" />
        <Skeleton width="w40" className="mb-0 h-[16px]" />
      </div>
      <p className="mt-[20px] text-center text-[11.5px] leading-[1.5] text-trust-gray">
        You can leave this page. The trade updates as soon as the payment is confirmed.
      </p>
    </Frame>
  );
}

/** AB4: nothing is lost, the trade is waiting, and the two ways forward. */
function NotConfirmed({
  trade,
  notice,
  busy,
  onCheckAgain,
  onRestart,
}: {
  trade: TradeView;
  notice: React.ReactNode;
  busy: boolean;
  onCheckAgain: () => void;
  onRestart: () => void;
}): React.JSX.Element {
  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <StatusHero tone="risk" as="h2" title="We couldn't confirm this payment">
        We haven&apos;t seen the money arrive, and your trade is still waiting, untouched. If you sent a
        transfer, this is usually a bank delay, not a failed payment.
      </StatusHero>
      <p className="mb-[14px] text-center text-[11.5px] text-trust-gray">
        If you contact support, quote <span className="font-mono">{trade.tradeCode}</span>.
      </p>
      {notice}
      <ActionStack>
        <Button type="button" disabled={busy} onClick={onCheckAgain}>
          I&apos;ve sent it — check again
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onRestart}>
          Start the payment again
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** V3: the money is held; the moment that unlocks the seller's dispatch. */
function Protected({ trade, payment }: { trade: TradeView; payment: PaymentStatus }): React.JSX.Element {
  const attempt = payment.attempt;
  const amount = attempt?.amountMinor ?? trade.fees?.buyerTotalMinor;
  const seller = trade.counterparty ? partyName(trade.counterparty) : 'The seller';
  return (
    <Frame title="Fund & Protect" back={tradeHref(trade.id)}>
      <StatusHero tone="success" as="h2" title="Funds protected" className="pt-[32px]">
        {amount === undefined ? 'Your payment' : nairaShort(amount)} is now held in escrow. {seller} is told
        it&apos;s safe to dispatch.
      </StatusHero>
      {attempt !== null && (
        <ReadyBanner
          title={attempt.confirmedAt === null ? 'Confirmed' : `Confirmed ${whenLabel(attempt.confirmedAt)}`}
        >
          Reference: {attempt.reference}
        </ReadyBanner>
      )}
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to trade timeline</a>
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
  backLabel = 'Back to the trade',
  children,
}: {
  title: string;
  back: string;
  backLabel?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title={title} backHref={back} backLabel={backLabel} />
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
