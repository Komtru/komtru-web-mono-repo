'use client';

import type { TradeView } from '@komtru/api-client';
import {
  useAcceptTrade,
  useCancelTrade,
  useClaimTrade,
  useDeclineTrade,
  useTrade,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  CodeCard,
  ItemCard,
  ScreenHeader,
  SectionLabel,
  Sheet,
  StatusHero,
  TermList,
  TermRow,
  TextField,
  VersionTimeline,
  type StatusHeroTone,
  type VersionStep,
} from '@komtru/ui-kit';
import { useEffect, useState } from 'react';
import { AddressPicker } from './AddressPicker';
import { addressLine, hoursLabel, itemSub, itemTitle, naira, problemMessage, isProblem } from './format';
import { rememberTrade } from './known-trades';
import { Column, LoadFailed, LoadingScreen, NoteBanner, ReadyBanner, RiskBanner, WarnBanner } from './parts';
import { ProofUpload } from './ProofUpload';

/**
 * One trade, as the person looking at it should see it right now.
 *
 * The backend decides what is true (the status, whose turn it is); this decides what to draw. A
 * proposal moves through a handful of states and each has one screen: the one it shows the person who
 * has to act, the one for the person who is waiting, the held and closed ends, and the agreement.
 * Anything past the agreement belongs to the trade workspace and is shown as a plain summary here.
 */
export function TradeScreen({ id }: { id: string }): React.JSX.Element {
  const trade = useTrade(id);

  // A trade somebody opens is a trade they are part of, so it joins the list on this device.
  const found = trade.data !== undefined;
  useEffect(() => {
    if (found) rememberTrade(id);
  }, [found, id]);

  if (trade.isPending) {
    return (
      <Column>
        <ScreenHeader title="Trade" backHref="/trades" />
        <LoadingScreen label="Loading the trade" />
      </Column>
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
  return <TradeState trade={trade.data} />;
}

function TradeState({ trade }: { trade: TradeView }): React.JSX.Element {
  const mine = trade.yourRole === trade.initiatorRole;
  switch (trade.status) {
    case 'UNDER_PROPOSAL_REVIEW':
      return <HeldForReview trade={trade} />;
    case 'REJECTED':
      return <NotSent trade={trade} />;
    case 'PENDING_COUNTERPARTY':
      return mine ? <WaitingOnThem trade={trade} /> : <ClaimInvitation trade={trade} />;
    case 'AWAITING_ACCEPTANCE':
      return trade.awaiting === 'YOU' ? <AnswerProposal trade={trade} /> : <WaitingOnThem trade={trade} />;
    case 'PENDING_PAYMENT':
      return <TermsAgreed trade={trade} />;
    case 'DECLINED':
    case 'CANCELLED':
    case 'EXPIRED':
      return <Closed trade={trade} />;
    default:
      return <MovedOn trade={trade} />;
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function ItemSummary({ trade }: { trade: TradeView }): React.JSX.Element | null {
  if (trade.terms === null) return null;
  const sub = itemSub(trade.terms.itemSpec);
  return (
    <ItemCard
      title={itemTitle(trade.terms.itemSpec)}
      {...(sub === undefined ? {} : { sub })}
      price={naira(trade.terms.itemAmountMinor)}
    />
  );
}

function TermsRows({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const { terms } = trade;
  if (terms === null) return null;
  const delivery = terms.deliveryAddress === null ? undefined : addressLine(terms.deliveryAddress);
  const shipsFrom = terms.shipsFromAddress === null ? undefined : addressLine(terms.shipsFromAddress);
  return (
    <TermList aria-label="Terms of this trade">
      <TermRow label="Price" checked>
        {naira(terms.itemAmountMinor)}
      </TermRow>
      <TermRow label="Inspection" checked>
        {hoursLabel(terms.inspectionWindowHours)}
        <span className="font-semibold text-info-on-soft"> · Trade Standard</span>
      </TermRow>
      {delivery !== undefined && (
        <TermRow label="Delivery to" checked>
          {delivery}
        </TermRow>
      )}
      {shipsFrom !== undefined && (
        <TermRow label="Ships from" checked>
          {shipsFrom}
        </TermRow>
      )}
      <TermRow label="Version" checked>
        {String(terms.versionNumber)}
      </TermRow>
    </TermList>
  );
}

const BACK_TO_TRADES = (
  <Button asChild variant="secondary">
    <a href="/trades">Back to your trades</a>
  </Button>
);

/** The confirmation every withdrawal goes through: a decision that cannot be undone asks once. */
function ConfirmSheet({
  open,
  title,
  confirm,
  pending,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? 'Working…' : confirm}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep it
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// R1 and Customer-2: a proposal waiting on you
// ---------------------------------------------------------------------------

function AnswerProposal({ trade }: { trade: TradeView }): React.JSX.Element {
  const selling = trade.yourRole === 'SELLER';
  const accept = useAcceptTrade();
  const decline = useDeclineTrade();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [proof, setProof] = useState<string[]>([]);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const ready = trade.terms !== null && addressId !== null && (!selling || proof.length > 0);

  const onAccept = () => {
    if (trade.terms === null || addressId === null) return;
    setProblem(undefined);
    accept.mutate(
      {
        id: trade.id,
        termsVersionId: trade.terms.versionId,
        addressId,
        ...(selling && proof.length > 0 ? { proofFileIds: proof } : {}),
      },
      { onError: (error) => setProblem(problemMessage(error, "We couldn't accept that. Try again.")) },
    );
  };

  const onDecline = () => {
    setProblem(undefined);
    decline.mutate(
      { id: trade.id, reason: reason.trim() },
      {
        onSuccess: () => setDeclining(false),
        onError: (error) => {
          setDeclining(false);
          setProblem(problemMessage(error, "We couldn't decline that. Try again."));
        },
      },
    );
  };

  return (
    <Column>
      <ScreenHeader title={selling ? 'New Request' : 'Review terms'} backHref="/trades" />
      <NoteBanner>
        {selling
          ? 'A buyer wants this from you. Review the terms, then accept, change them or decline.'
          : 'A seller proposed these terms. Review them, then accept, change them or decline.'}
      </NoteBanner>
      <ItemSummary trade={trade} />
      <SectionLabel>{selling ? "Buyer's proposed terms" : 'Terms of this trade'}</SectionLabel>
      <TermsRows trade={trade} />
      <div className="mt-[16px]">
        <AddressPicker
          label={selling ? 'Ships from' : 'Delivery address'}
          value={addressId}
          onChange={setAddressId}
        />
      </div>
      {selling && (
        <>
          <SectionLabel>Proof of the item</SectionLabel>
          <ProofUpload required={1} onChange={setProof} step="accept" />
        </>
      )}
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button type="button" onClick={onAccept} disabled={!ready || accept.isPending}>
          {accept.isPending ? 'Accepting…' : selling ? 'Accept trade request' : 'Accept terms'}
        </Button>
        <Button asChild variant="secondary">
          <a href={`/trade/${trade.id}/counter`}>Propose a change</a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="self-center"
          onClick={() => {
            setDeclining(true);
          }}
        >
          Decline
        </Button>
      </ActionStack>
      <ConfirmSheet
        open={declining}
        title="Decline this request"
        confirm="Decline request"
        pending={decline.isPending}
        onConfirm={onDecline}
        onClose={() => {
          setDeclining(false);
        }}
      >
        <p className="mb-[12px] text-[12.5px] leading-[1.5] text-slate">
          They&apos;ll see your reason. This ends the request.
        </p>
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          {...(reason.trim().length > 0 && reason.trim().length < 3
            ? { helper: 'Give a few words', invalid: true }
            : {})}
        />
      </ConfirmSheet>
    </Column>
  );
}

// ---------------------------------------------------------------------------
// Waiting on the other party, and the invite
// ---------------------------------------------------------------------------

function WaitingOnThem({ trade }: { trade: TradeView }): React.JSX.Element {
  const invited = trade.status === 'PENDING_COUNTERPARTY';
  const cancel = useCancelTrade();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const onCancel = () => {
    setProblem(undefined);
    cancel.mutate(
      { id: trade.id },
      {
        onSuccess: () => setConfirming(false),
        onError: (error) => {
          setConfirming(false);
          setProblem(problemMessage(error, "We couldn't cancel that. Try again."));
        },
      },
    );
  };

  return (
    <Column>
      <StatusHero tone="info" title={invited ? 'Invitation waiting' : 'Request sent'}>
        {invited
          ? "They're not on Komtru yet. When they sign up with the phone number or email you used, this request is waiting for them. Send them the Trade Code so they know it's from you."
          : "They've been notified. You'll see their answer here, and you can change your mind until they accept."}
      </StatusHero>
      <ItemSummary trade={trade} />
      <CodeCard label="Trade Code" code={trade.tradeCode} />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        {BACK_TO_TRADES}
        <Button
          type="button"
          variant="ghost"
          className="self-center"
          onClick={() => {
            setConfirming(true);
          }}
        >
          {invited ? 'Withdraw the invitation' : 'Cancel this request'}
        </Button>
      </ActionStack>
      <ConfirmSheet
        open={confirming}
        title="Cancel this request"
        confirm="Cancel request"
        pending={cancel.isPending}
        onConfirm={onCancel}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p className="text-[12.5px] leading-[1.5] text-slate">
          The other party won&apos;t be able to accept it. Nothing has been paid.
        </p>
      </ConfirmSheet>
    </Column>
  );
}

function ClaimInvitation({ trade }: { trade: TradeView }): React.JSX.Element {
  const claim = useClaimTrade();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  return (
    <Column>
      <ScreenHeader title="You're invited" backHref="/trades" />
      <NoteBanner>
        Someone invited you to this trade. Take your place in it to see the terms and answer.
      </NoteBanner>
      <ItemSummary trade={trade} />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button
          type="button"
          disabled={claim.isPending}
          onClick={() => {
            setProblem(undefined);
            claim.mutate(trade.id, {
              onError: (error) =>
                setProblem(problemMessage(error, "We couldn't add you to this trade. Try again.")),
            });
          }}
        >
          {claim.isPending ? 'Joining…' : 'Take your place'}
        </Button>
      </ActionStack>
    </Column>
  );
}

// ---------------------------------------------------------------------------
// G3 and IF1: held, and not sent
// ---------------------------------------------------------------------------

/**
 * G3, as far as the platform goes today: the proposal is held, nobody has seen it, and the person
 * keeps their Trade Code. The drawing also asks for an ID upload; that is the risk-hold feature
 * (post-MVP), and no route takes the document, so it is not drawn.
 */
function HeldForReview({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <Column>
      <StatusHero tone="info" title="Held for review">
        The other party hasn&apos;t seen this yet. We&apos;re checking it before it&apos;s forwarded, and
        you&apos;ll see it move on here as soon as it&apos;s cleared.
      </StatusHero>
      <NoteBanner>
        This isn&apos;t a judgment about you. Some proposals are checked first, and yours is one of them.
      </NoteBanner>
      <CodeCard label="Your Trade Code. Save this either way" code={trade.tradeCode} />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </Column>
  );
}

/** IF1's shape for the other state a review can end in: not forwarded, and the trade cannot continue. */
function NotSent({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <Column>
      <ScreenHeader title="Not sent" backHref="/trades" />
      <StatusHero tone="risk" title="This proposal can't go ahead" className="pt-[8px]">
        It didn&apos;t pass review, so it wasn&apos;t sent. Nothing has been paid.
      </StatusHero>
      <WarnBanner title="This isn't automatically your fault">
        Reviews look at the trade, not only the people in it. You can start a new proposal with different
        terms.
      </WarnBanner>
      <CodeCard label="Trade Code" code={trade.tradeCode} />
      <ActionStack>
        <Button asChild>
          <a href="/trade/new">Start a new trade</a>
        </Button>
        {BACK_TO_TRADES}
      </ActionStack>
    </Column>
  );
}

// ---------------------------------------------------------------------------
// TC-06: terms agreed
// ---------------------------------------------------------------------------

function versionSteps(trade: TradeView): VersionStep[] {
  const current = trade.terms?.versionNumber ?? 1;
  const roleOf = (n: number) =>
    // A counter-proposal flips the turn, so versions alternate between the two sides from the first.
    (n % 2 === 1) === (trade.initiatorRole === 'BUYER') ? 'Buyer' : 'Seller';
  return Array.from({ length: current }, (_, index) => {
    const n = index + 1;
    return n === current
      ? {
          id: String(n),
          title: `Version ${String(n)} · Accepted`,
          detail: `Proposed by the ${roleOf(n).toLowerCase()}. Current agreed version`,
          state: 'done' as const,
        }
      : {
          id: String(n),
          title: `Version ${String(n)} · ${roleOf(n)} ${n === 1 ? 'proposal' : 'counter'}`,
          detail: 'Superseded',
          state: 'done' as const,
        };
  });
}

function TermsAgreed({ trade }: { trade: TradeView }): React.JSX.Element {
  const buyer = trade.yourRole === 'BUYER';
  const tone: StatusHeroTone = 'success';
  return (
    <Column>
      <StatusHero tone={tone} title="Terms agreed">
        Both parties accepted this version, so the trade has been created.
      </StatusHero>
      <ReadyBanner title="Agreement recorded">
        Version {String(trade.terms?.versionNumber ?? 1)} · accepted by buyer and seller. Payment hasn&apos;t
        been made.
      </ReadyBanner>
      <ItemSummary trade={trade} />
      {trade.fees !== null && (
        <TermList aria-label="What this comes to">
          <TermRow label="Item price">{naira(trade.fees.itemAmountMinor)}</TermRow>
          {buyer ? (
            <>
              <TermRow label="Buyer protection fee">{naira(trade.fees.buyerProtectionFeeMinor)}</TermRow>
              <TermRow label="You pay">
                <b className="text-midnight-text">{naira(trade.fees.buyerTotalMinor)}</b>
              </TermRow>
            </>
          ) : (
            <TermRow label="You receive">
              <b className="text-midnight-text">{naira(trade.fees.sellerProceedsMinor)}</b>
            </TermRow>
          )}
        </TermList>
      )}
      <SectionLabel>Agreement history</SectionLabel>
      <VersionTimeline aria-label="Versions of this agreement" steps={versionSteps(trade)} />
      <p className="mt-[12px] text-[11.5px] leading-[1.6] text-trust-gray">
        {buyer
          ? "The next step is for you to fund the trade. Payment isn't available in the app yet, so there's nothing to do here until it is."
          : "The next step is for the buyer to fund the trade. You'll be told when they have."}
      </p>
      <CodeCard label="Trade Code" code={trade.tradeCode} className="mt-[16px]" />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </Column>
  );
}

// ---------------------------------------------------------------------------
// The ends that are not an agreement, and everything after it
// ---------------------------------------------------------------------------

const CLOSED: Record<string, { title: string; body: string }> = {
  DECLINED: {
    title: 'Request declined',
    body: 'The trade ended without any payment. You can start a new one.',
  },
  CANCELLED: {
    title: 'Request cancelled',
    body: 'The trade ended without any payment. You can start a new one.',
  },
  EXPIRED: {
    title: 'Request expired',
    body: 'Nobody answered in time, so the trade ended without any payment.',
  },
};

function Closed({ trade }: { trade: TradeView }): React.JSX.Element {
  const copy = CLOSED[trade.status] ?? CLOSED.CANCELLED;
  return (
    <Column>
      <StatusHero tone="warning" title={copy?.title ?? 'Trade ended'}>
        {copy?.body}
      </StatusHero>
      <ItemSummary trade={trade} />
      <CodeCard label="Trade Code" code={trade.tradeCode} />
      <ActionStack>
        <Button asChild>
          <a href="/trade/new">Start a new trade</a>
        </Button>
        {BACK_TO_TRADES}
      </ActionStack>
    </Column>
  );
}

function MovedOn({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <Column>
      <ScreenHeader title={trade.tradeCode} backHref="/trades" />
      <ItemSummary trade={trade} />
      <TermsRows trade={trade} />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </Column>
  );
}
