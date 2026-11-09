'use client';

import type { TradeView } from '@komtru/api-client';
import {
  useCancelTrade,
  useDeliveryDeadline,
  useInspection,
  useTradeActivity,
  useTradeLive,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  CodeCard,
  CountdownStrip,
  InfoCard,
  InfoRow,
  NoteBanner,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  StatusHero,
  TabNav,
  TermList,
  TermRow,
  TradeRow,
  VersionTimeline,
  WarnBanner,
  type VersionStep,
} from '@komtru/ui-kit';
import { useState } from 'react';
import {
  hoursLabel,
  addressLine,
  initialsOf,
  itemTitle,
  naira,
  nairaShort,
  partyName,
  problemMessage,
  whenLabel,
} from './format';
import { BACK_TO_TRADES, ConfirmSheet, ItemSummary, PartyHeader, TermsRows, versionSteps } from './parts';
import {
  describeActivity,
  tabItems,
  tabHref,
  tradeActions,
  workspaceStanding,
  type TradeRole,
  type WorkspaceStatus,
  type WorkspaceTab,
} from './workspace-state';

/**
 * The trade, from the agreement onward: the one screen every later trade feature renders a tab or a sheet
 * inside. It is ONE surface for both people. The trade says which side the reader is (`yourRole`), and the words
 * and the rows below follow from that; there is no buyer's workspace and seller's workspace to keep in step.
 *
 * What is true comes from the platform. The screen keeps itself current by listening on the trade's room and
 * reading the trade again when told something changed (never by drawing from the message), and again on every
 * reconnect, because a push missed while offline is never repeated.
 */
export function Workspace({
  trade,
  status,
  tab,
}: {
  trade: TradeView;
  status: WorkspaceStatus;
  tab: WorkspaceTab;
}): React.JSX.Element {
  useTradeLive([{ id: trade.id, code: trade.tradeCode }]);
  const standing = workspaceStanding(status);
  const role = trade.yourRole;
  const counterparty = trade.counterparty;
  const name = counterparty === undefined || counterparty === null ? undefined : partyName(counterparty);

  return (
    <ScreenColumn>
      <ScreenHeader title={trade.tradeCode} backHref="/trades" />
      <TradeRow
        amount={trade.terms === null ? '—' : nairaShort(trade.terms.itemAmountMinor)}
        status={standing.chip}
        {...(name === undefined
          ? {}
          : { counterparty: { name, initials: initialsOf(name.replace(/^@/, '')) } })}
        {...(trade.terms === null ? {} : { sub: itemTitle(trade.terms.itemSpec) })}
        {...(standing.stage === undefined ? {} : { stage: standing.stage })}
        className="mb-[14px]"
      />
      <TabNav aria-label="Trade views" items={tabItems(trade.id)} current={tab} />
      {tab === 'overview' && <Overview trade={trade} status={status} role={role} />}
      {tab === 'terms' && <TermsTab trade={trade} />}
      {tab === 'activity' && <ActivityTab trade={trade} />}
      {tab === 'actions' && <ActionsTab trade={trade} status={status} role={role} />}
    </ScreenColumn>
  );
}

// ---------------------------------------------------------------------------
// Overview: one body per status, wording from the reader's side
// ---------------------------------------------------------------------------

interface BodyProps {
  trade: TradeView;
  role: TradeRole;
}

function Overview({ trade, status, role }: BodyProps & { status: WorkspaceStatus }): React.JSX.Element {
  switch (status) {
    case 'PENDING_PAYMENT':
      return <AwaitingFunding trade={trade} role={role} />;
    case 'FUNDED':
      return <FundsProtected trade={trade} role={role} />;
    case 'SHIPPED':
      return <InTransit trade={trade} role={role} />;
    case 'UNCONFIRMED_DELIVERY':
      return <DeliveryToConfirm trade={trade} role={role} />;
    case 'INSPECTION':
      return <Inspection trade={trade} role={role} />;
    case 'DISPUTED':
      return <Disputed trade={trade} role={role} />;
    case 'COMPLETED':
      return <Settlement trade={trade} role={role} />;
    case 'SETTLED':
      return <TradeComplete trade={trade} role={role} />;
    case 'RESOLVED_RELEASED':
    case 'RESOLVED_REFUNDED':
    case 'CANCELLED_REFUNDED':
      return <Outcome trade={trade} role={role} status={status} />;
  }
}

/** The two links every overview ends with: the agreement it follows and the record of what happened. */
function FurtherViews({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <ActionStack>
      <Button asChild variant="secondary">
        <a href={tabHref(trade.id, 'terms')}>View agreed terms</a>
      </Button>
      <Button asChild variant="secondary">
        <a href={tabHref(trade.id, 'activity')}>View activity</a>
      </Button>
      {BACK_TO_TRADES}
    </ActionStack>
  );
}

/** A step that belongs to a later feature, said plainly with no control (SEAM: replaced by that feature). */
function NotInTheAppYet({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">{children}</p>;
}

/** The money, in the reader's terms, straight from the trade's own fee snapshot. */
function MoneyRows({ trade, role, held }: BodyProps & { held: string }): React.JSX.Element | null {
  const { fees } = trade;
  if (fees === null) return null;
  return (
    <>
      <SectionLabel>Money</SectionLabel>
      <TermList aria-label="Money">
        {role === 'BUYER' ? (
          <>
            <TermRow label="You paid">{naira(fees.buyerTotalMinor)}</TermRow>
            <TermRow label="Seller payout">{held}</TermRow>
          </>
        ) : (
          <>
            <TermRow label="Protected funds">Confirmed · {naira(fees.itemAmountMinor)}</TermRow>
            <TermRow label="Your payout">
              {naira(fees.sellerProceedsMinor)} · {held}
            </TermRow>
          </>
        )}
      </TermList>
    </>
  );
}

/** What was agreed about getting the item there, from the trade's own terms. */
function Fulfilment({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const { terms } = trade;
  if (terms === null) return null;
  return (
    <>
      <SectionLabel>Fulfilment</SectionLabel>
      <TermList aria-label="Terms of this trade">
        {terms.deliveryAddress !== null && (
          <TermRow label="Delivery to">{addressLine(terms.deliveryAddress)}</TermRow>
        )}
        {terms.shipsFromAddress !== null && (
          <TermRow label="Ships from">{addressLine(terms.shipsFromAddress)}</TermRow>
        )}
        <TermRow label="Inspection">{hoursLabel(terms.inspectionWindowHours)}</TermRow>
      </TermList>
    </>
  );
}

/** A deadline read from its own route: shown when there, said plainly when it cannot be read. */
function Deadline({
  label,
  query,
  pick,
}: {
  label: string;
  query: { isPending: boolean; isError: boolean; refetch: () => unknown };
  pick: () => string | null | undefined;
}): React.JSX.Element | null {
  if (query.isPending) return <Skeleton width="full" lines={1} />;
  if (query.isError) {
    return (
      <p role="alert" className="mb-[14px] text-[12px] text-risk-on-soft">
        We couldn&apos;t load the {label.toLowerCase()}.{' '}
        <button type="button" className="underline" onClick={() => void query.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  const at = pick();
  return at === null || at === undefined ? null : (
    <CountdownStrip>
      {label} · {whenLabel(at)}
    </CountdownStrip>
  );
}

// -- CWT-01 -------------------------------------------------------------------

/**
 * CWT-01, and TC-06 before it: the agreement is recorded and nobody has paid. The next step is the buyer's
 * funding, which is F-024.
 */
function AwaitingFunding({ trade, role }: BodyProps): React.JSX.Element {
  const buyer = role === 'BUYER';
  return (
    <>
      <StatusHero tone="success" as="h2" title="Terms agreed">
        Both parties accepted this version, so the trade has been created.
      </StatusHero>
      <ReadyBanner title="Agreement recorded">
        Version {String(trade.terms?.versionNumber ?? 1)} · accepted by buyer and seller. Payment hasn&apos;t
        been made.
      </ReadyBanner>
      <ItemSummary trade={trade} />
      <FeeList trade={trade} role={role} />
      <SectionLabel>Agreement history</SectionLabel>
      <VersionTimeline aria-label="Versions of this agreement" steps={versionSteps(trade)} />
      {/* SEAM(F-024): "Fund this trade" for the buyer goes here, above this line, when payment exists. */}
      <p className="mt-[12px] text-[11.5px] leading-[1.6] text-trust-gray">
        {buyer
          ? "The next step is for you to fund the trade. Payment isn't available in the app yet, so there's nothing to do here until it is."
          : "The next step is for the buyer to fund the trade. You'll be told when they have."}
      </p>
      <CodeCard label="Trade Code" code={trade.tradeCode} className="mt-[16px]" />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </>
  );
}

/** What the trade comes to for the reader: the buyer's total, or what the seller receives. */
function FeeList({ trade, role }: BodyProps): React.JSX.Element | null {
  const { fees } = trade;
  if (fees === null) return null;
  return (
    <TermList aria-label="What this comes to">
      <TermRow label="Item price">{naira(fees.itemAmountMinor)}</TermRow>
      {role === 'BUYER' ? (
        <>
          <TermRow label="Buyer protection fee">{naira(fees.buyerProtectionFeeMinor)}</TermRow>
          <TermRow label="You pay">
            <b className="text-midnight-text">{naira(fees.buyerTotalMinor)}</b>
          </TermRow>
        </>
      ) : (
        <TermRow label="You receive">
          <b className="text-midnight-text">{naira(fees.sellerProceedsMinor)}</b>
        </TermRow>
      )}
    </TermList>
  );
}

// -- CWT-02 -------------------------------------------------------------------

function FundsProtected({ trade, role }: BodyProps): React.JSX.Element {
  const deadline = useDeliveryDeadline(trade.id, true);
  const buyer = role === 'BUYER';
  return (
    <>
      {buyer ? (
        <ReadyBanner title="Your funds are protected">
          Komtru is holding the payment. The seller can ship now, and you&apos;ll see it here the moment they
          do. No action needed from you.
        </ReadyBanner>
      ) : (
        <ReadyBanner title="Prepare and dispatch">
          Komtru has confirmed the buyer&apos;s funds are protected. Review the agreed details below, then
          hand the item over.
        </ReadyBanner>
      )}
      <Deadline
        label={buyer ? 'The seller ships by' : 'Ship by'}
        query={deadline}
        pick={() => deadline.data?.deadline?.dueAt}
      />
      <MoneyRows trade={trade} role={role} held="held, not yet released" />
      <Fulfilment trade={trade} />
      {/* SEAM(F-026): the seller's "Prepare & dispatch" action goes here when shipping exists. */}
      {!buyer && <NotInTheAppYet>Marking the item shipped isn&apos;t in the app yet.</NotInTheAppYet>}
      <FurtherViews trade={trade} />
    </>
  );
}

// -- CWT-03 -------------------------------------------------------------------

/** The shipment, as far as the platform records it: when it was handed over and the waybill. */
function Shipment({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const inspection = useInspection(trade.id, true);
  const shipped = inspection.data?.deliveryEvidence.selfArranged;
  if (inspection.isPending) return <Skeleton width="full" lines={2} />;
  if (inspection.isError) {
    return (
      <p role="alert" className="mb-[14px] text-[12px] text-risk-on-soft">
        We couldn&apos;t load the shipment details.{' '}
        <button type="button" className="underline" onClick={() => void inspection.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  if (shipped === null || shipped === undefined) return null;
  return (
    <InfoCard aria-label="Shipment">
      <InfoRow title="Dispatched" detail={`${whenLabel(shipped.shippedAt)} · arranged by the seller`} />
      <InfoRow title="Waybill" detail={shipped.waybillNumber} />
    </InfoCard>
  );
}

function InTransit({ trade, role }: BodyProps): React.JSX.Element {
  const buyer = role === 'BUYER';
  return (
    <>
      <ReadyBanner title={buyer ? 'Your item is in transit' : 'The item is on its way'}>
        {buyer
          ? 'The seller has dispatched the item. Keep the agreed terms to hand until it arrives.'
          : 'You have dispatched the item. The buyer is asked to confirm when it arrives.'}
      </ReadyBanner>
      <Shipment trade={trade} />
      <SectionLabel>What happens at arrival</SectionLabel>
      <TermList aria-label="At arrival">
        <TermRow label="Funds">Protected</TermRow>
        <TermRow label={buyer ? 'Seller payout' : 'Your payout'}>Held until settlement</TermRow>
        <TermRow label="Inspection">
          {trade.terms === null
            ? 'Starts on delivery'
            : `${hoursLabel(trade.terms.inspectionWindowHours)} from delivery`}
        </TermRow>
      </TermList>
      {/* SEAM(F-026/F-027): delivery tracking detail, "Report delivery" and "Confirm you have it". */}
      <FurtherViews trade={trade} />
    </>
  );
}

function DeliveryToConfirm({ trade, role }: BodyProps): React.JSX.Element {
  const buyer = role === 'BUYER';
  const grace = trade.terms === null ? undefined : hoursLabel(trade.terms.deliveryGraceHours);
  return (
    <>
      {buyer ? (
        <WarnBanner title="Did it arrive?">
          The seller says the item was delivered. Check you have it. If you don&apos;t answer
          {grace === undefined ? '' : ` within ${grace}`}, the delivery is treated as confirmed and your
          inspection time starts.
        </WarnBanner>
      ) : (
        <NoteBanner title="Waiting for the buyer to confirm">
          You&apos;ve reported the item delivered. If the buyer doesn&apos;t answer
          {grace === undefined ? '' : ` within ${grace}`}, the delivery is treated as confirmed.
        </NoteBanner>
      )}
      <Shipment trade={trade} />
      {/* SEAM(F-027): the buyer's "Confirm delivery" goes here. */}
      {buyer && <NotInTheAppYet>Confirming delivery isn&apos;t in the app yet.</NotInTheAppYet>}
      <FurtherViews trade={trade} />
    </>
  );
}

// -- CWT-04 -------------------------------------------------------------------

function Inspection({ trade, role }: BodyProps): React.JSX.Element {
  const inspection = useInspection(trade.id, true);
  const buyer = role === 'BUYER';
  const data = inspection.data;
  return (
    <>
      {buyer ? (
        <NoteBanner title="Inspect the item">
          Compare what you received with the agreed terms. You can accept the item, report an issue or ask for
          more time.
        </NoteBanner>
      ) : (
        <NoteBanner title="The buyer is inspecting the item">
          If the window passes with no issue reported, the payment is released to you automatically.
        </NoteBanner>
      )}
      {data?.window.autoReleasePaused === true && (
        <WarnBanner title="Automatic release is paused">
          Komtru is looking at this trade, so the window will not release the payment by itself for now.
        </WarnBanner>
      )}
      <Deadline label="Inspection ends" query={inspection} pick={() => data?.window.deadlineAt} />
      {data !== undefined && (
        <>
          {data.extensionRequest?.status === 'PENDING' && (
            <NoteBanner title="More inspection time was asked for">
              {buyer
                ? 'You asked the seller for more time. The window stays as it is until they answer.'
                : 'The buyer asked for more inspection time. Your answer is needed.'}
            </NoteBanner>
          )}
          <SectionLabel>Inspection</SectionLabel>
          <TermList aria-label="Inspection window">
            {trade.categoryName !== null && <TermRow label="Category">{trade.categoryName}</TermRow>}
            <TermRow label="Window">{hoursLabel(data.window.hours)}</TermRow>
            {data.window.startedAt !== null && (
              <TermRow label="Started">{whenLabel(data.window.startedAt)}</TermRow>
            )}
            {data.window.deadlineAt !== null && (
              <TermRow label="Ends">
                {whenLabel(data.window.deadlineAt)}
                {data.window.extended ? ' · extended' : ''}
              </TermRow>
            )}
          </TermList>
        </>
      )}
      {/* SEAM(F-027): "Inspect & compare", accept and release, ask for more time, answer a request, report an issue. */}
      <NotInTheAppYet>
        {buyer
          ? "Accepting the item, asking for more time and reporting an issue aren't in the app yet."
          : "Answering a request for more time isn't in the app yet."}
      </NotInTheAppYet>
      <FurtherViews trade={trade} />
    </>
  );
}

// -- CWT-05 -------------------------------------------------------------------

function Disputed({ trade, role }: BodyProps): React.JSX.Element {
  return (
    <>
      <WarnBanner title="Issue reported — funds remain protected">
        {role === 'BUYER'
          ? 'The issue is now a case. The payment stays held until it is decided against the agreed terms.'
          : 'The buyer reported an issue. The payment stays held until the case is decided against the agreed terms.'}
      </WarnBanner>
      <MoneyRows trade={trade} role={role} held="held while the case is open" />
      {/* SEAM(F-032): the case reference, its stage, the evidence deadline and "Submit evidence". */}
      <NotInTheAppYet>The case, and sending evidence to it, aren&apos;t in the app yet.</NotInTheAppYet>
      <FurtherViews trade={trade} />
    </>
  );
}

// -- CWT-06 -------------------------------------------------------------------

function Settlement({ trade, role }: BodyProps): React.JSX.Element {
  const { fees } = trade;
  const buyer = role === 'BUYER';
  return (
    <>
      <NoteBanner title="Settlement is processing">
        The trade outcome is recorded. Komtru is carrying out the payment to the seller; it is not yet a
        completed payout.
      </NoteBanner>
      <SectionLabel>Financial outcome</SectionLabel>
      <TermList aria-label="Financial outcome">
        <TermRow label="Status">
          Processing
          {fees === null ? '' : ` · ${naira(buyer ? fees.itemAmountMinor : fees.sellerProceedsMinor)}`}
        </TermRow>
        <TermRow label="Trade outcome">Completed</TermRow>
        <TermRow label="Payment instruction">Release to seller</TermRow>
      </TermList>
      <FurtherViews trade={trade} />
    </>
  );
}

// -- Customer-5 ---------------------------------------------------------------

function TradeComplete({ trade, role }: BodyProps): React.JSX.Element {
  const { fees } = trade;
  const seller =
    trade.counterparty === undefined || trade.counterparty === null
      ? undefined
      : partyName(trade.counterparty);
  const line =
    fees === null
      ? 'Both sides honoured the agreement in full.'
      : role === 'BUYER'
        ? `${naira(fees.itemAmountMinor)} released${seller === undefined ? '' : ` to ${seller}`}. Both sides honoured the agreement in full.`
        : `${naira(fees.sellerProceedsMinor)} released to you. Both sides honoured the agreement in full.`;
  return (
    <>
      <StatusHero tone="success" as="h2" title="Trade complete">
        {line}
      </StatusHero>
      <ItemSummary trade={trade} />
      {/* SEAM(F-038): "Leave a review", and the count of trades on the Trust Profile (F-016). */}
      <FurtherViews trade={trade} />
    </>
  );
}

// -- The other ends -----------------------------------------------------------

const OUTCOME: Record<
  'RESOLVED_RELEASED' | 'RESOLVED_REFUNDED' | 'CANCELLED_REFUNDED',
  { title: string; buyer: string; seller: string }
> = {
  RESOLVED_RELEASED: {
    title: 'Decided: released to the seller',
    buyer: 'The case was decided in the seller’s favour. The payment is released to them.',
    seller: 'The case was decided in your favour. The payment is released to you.',
  },
  RESOLVED_REFUNDED: {
    title: 'Decided: refunded to the buyer',
    buyer: 'The case was decided in your favour. You are refunded.',
    seller: 'The case was decided in the buyer’s favour. They are refunded.',
  },
  CANCELLED_REFUNDED: {
    title: 'Cancelled and refunded',
    buyer: 'The trade was cancelled after payment. You are refunded.',
    seller: 'The trade was cancelled after payment. The buyer is refunded.',
  },
};

function Outcome({ trade, role, status }: BodyProps & { status: keyof typeof OUTCOME }): React.JSX.Element {
  const copy = OUTCOME[status];
  return (
    <>
      <StatusHero tone="success" as="h2" title={copy.title}>
        {role === 'BUYER' ? copy.buyer : copy.seller}
      </StatusHero>
      <NoteBanner>
        The outcome is recorded. Komtru confirms the payment itself separately, so this is not a confirmation
        that the money has arrived.
      </NoteBanner>
      <ItemSummary trade={trade} />
      <FurtherViews trade={trade} />
    </>
  );
}

// ---------------------------------------------------------------------------
// CWT-07: Terms
// ---------------------------------------------------------------------------

function TermsTab({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <>
      <ReadyBanner title="Terms recorded">
        The accepted version is the reference for fulfilment, inspection and any later dispute.
      </ReadyBanner>
      <ItemSummary trade={trade} />
      <PartyHeader trade={trade} />
      <SectionLabel>Terms of this trade</SectionLabel>
      <TermsRows trade={trade} />
      <FeeList trade={trade} role={trade.yourRole} />
      <SectionLabel>Agreement history</SectionLabel>
      <VersionTimeline aria-label="Versions of this agreement" steps={versionSteps(trade)} />
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>Back to overview</a>
        </Button>
      </ActionStack>
    </>
  );
}

// ---------------------------------------------------------------------------
// CWT-08: Activity
// ---------------------------------------------------------------------------

function ActivityTab({ trade }: { trade: TradeView }): React.JSX.Element {
  const feed = useTradeActivity(trade.id);

  if (feed.isPending) {
    return (
      <div role="status" aria-label="Loading the activity" aria-busy="true">
        <Skeleton width="full" lines={4} />
      </div>
    );
  }
  if (feed.isError) {
    return (
      <RiskBanner title="Couldn't load the activity">
        <button type="button" className="underline" onClick={() => void feed.refetch()}>
          Try again
        </button>
      </RiskBanner>
    );
  }

  const items = feed.data.pages.flatMap((page) => page.items);
  const steps: VersionStep[] = items.map((item) => {
    const { title, detail } = describeActivity(item, trade.yourRole);
    return {
      id: item.id,
      title,
      detail: [whenLabel(item.occurredAt), ...detail].join(' · '),
      state: 'done',
    };
  });

  return (
    <>
      <NoteBanner title="Read only">A record of what happened, who acted and when. Newest first.</NoteBanner>
      {steps.length === 0 ? (
        <p className="text-[12.5px] text-slate">Nothing has happened on this trade yet.</p>
      ) : (
        <VersionTimeline aria-label="Trade activity" steps={steps} />
      )}
      {feed.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          className="mt-[12px]"
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? 'Loading…' : 'Show earlier activity'}
        </Button>
      )}
      {feed.isFetchNextPageError && (
        <p role="alert" className="mt-[8px] text-[12px] font-semibold text-risk-on-soft">
          Couldn&apos;t load earlier activity. Try again.
        </p>
      )}
      <p className="mt-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
        Each change to the trade is recorded with who made it and when. Komtru&apos;s own steps, including its
        reviewers and the payment service, appear simply as Komtru.
      </p>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>Back to trade overview</a>
        </Button>
      </ActionStack>
    </>
  );
}

// ---------------------------------------------------------------------------
// CWT-09: Actions
// ---------------------------------------------------------------------------

function ActionsTab({
  trade,
  status,
  role,
}: {
  trade: TradeView;
  status: WorkspaceStatus;
  role: TradeRole;
}): React.JSX.Element {
  const cancel = useCancelTrade();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const rows = tradeActions(status, role, trade.id);
  const canWithdraw = rows.some((row) => row.id === 'cancel');

  const onWithdraw = () => {
    setProblem(undefined);
    cancel.mutate(
      { id: trade.id },
      {
        // The trade is now cancelled; the screen re-renders as the closed trade, so nothing to close here.
        onSuccess: () => setConfirming(false),
        onError: (error) => {
          setConfirming(false);
          setProblem(problemMessage(error, "We couldn't withdraw from the trade. Try again."));
        },
      },
    );
  };

  return (
    <>
      <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
        What you can do depends on where the trade is and which side you are on.
      </p>
      <InfoCard aria-label="Actions on this trade">
        {rows.map((row) => (
          <InfoRow
            key={row.id}
            title={row.title}
            detail={row.availability === 'later' ? `${row.description} Not in the app yet.` : row.description}
            {...(row.href === undefined ? {} : { href: row.href })}
          />
        ))}
      </InfoCard>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        {canWithdraw && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Withdraw from this trade
          </Button>
        )}
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>View current trade</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'activity')}>Open trade activity</a>
        </Button>
      </ActionStack>
      <ConfirmSheet
        open={confirming}
        title="Withdraw from this trade"
        confirm="Withdraw"
        pending={cancel.isPending}
        onConfirm={onWithdraw}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p className="text-[12.5px] leading-[1.5] text-slate">
          This ends the trade for both of you. Nothing has been paid, so nothing is charged.
        </p>
      </ConfirmSheet>
    </>
  );
}
