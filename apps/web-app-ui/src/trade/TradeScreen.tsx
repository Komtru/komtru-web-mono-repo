'use client';

import type { TradeView } from '@komtru/api-client';
import {
  useAcceptTrade,
  useCancelTrade,
  useDeclineTrade,
  useTrade,
  usePinnedStandard,
  useTradeLive,
  tradeKeys,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  CodeCard,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  StatusHero,
  TextField,
  WarnBanner,
} from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkNotFound } from '../system/LinkNotFound';
import { AddressPicker } from './AddressPicker';
import { ClaimPanel } from './ClaimPanel';
import { ShareTrade } from './ShareTrade';
import { isProblem, proofNeeds, problemMessage } from './format';
import { BACK_TO_TRADES, ConfirmSheet, ItemSummary, PartyHeader, TermsRows } from './parts';
import { ProposeWorkspace } from './create/ProposeWorkspace';
import { ReviewAccept } from './create/ReviewAccept';
import { BuyerChoose } from './create/BuyerChoose';
import { isRequestShaped, isRequestSpec, isSellerOffer } from './create/request';
import { SellerRequest } from './create/SellerRequest';
import { ProofUpload } from './ProofUpload';
import { TradeExpired } from './terms/TradeExpired';
import { TradeCancelled } from './cancel/TradeCancelled';
import { Workspace } from './workspace/Workspace';
import { isWorkspaceStatus, type WorkspaceTab } from './workspace-state';

/**
 * One trade, as the person looking at it should see it right now.
 *
 * The backend decides what is true (the status, whose turn it is); this decides what to draw. A
 * proposal moves through a handful of states and each has one screen: the one it shows the person who
 * has to act, the one for the person who is waiting, the held and closed ends, and the agreement.
 * From the agreement onward the trade is the workspace (`Workspace`), behind this same route: one screen decides
 * what a trade looks like, whichever stage it is at, so the proposal and the workspace cannot drift apart.
 */
export function TradeScreen({ id, tab = 'overview' }: { id: string; tab?: WorkspaceTab }): React.JSX.Element {
  const trade = useTrade(id);
  // Every stage listens, not only the workspace: a proposer waiting on an answer is the person who most needs
  // to see it arrive (AWAITING_ACCEPTANCE to PENDING_PAYMENT), and a held one is waiting on review.
  useTradeLive(trade.data === undefined ? [] : [{ id: trade.data.id, code: trade.data.tradeCode }]);

  if (trade.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Trade" backHref="/trades" />
        <LoadingScreen label="Loading the trade" />
      </ScreenColumn>
    );
  }
  // SP-M19: a trade that is not there (or not this person's) is a dead link, and said so as one.
  if (trade.isError && isProblem(trade.error, 'NOT_FOUND')) return <LinkNotFound />;
  if (trade.isError) {
    return (
      <LoadFailed
        title="Couldn't open this trade"
        body={problemMessage(trade.error, 'Check your connection and try again.')}
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }
  return <TradeState trade={trade.data} tab={tab} />;
}

function TradeState({ trade, tab }: { trade: TradeView; tab: WorkspaceTab }): React.JSX.Element {
  const mine = trade.yourRole === trade.initiatorRole;
  // From the agreement onward the trade is the workspace; everything before it is a proposal, drawn below.
  if (isWorkspaceStatus(trade.status)) return <Workspace trade={trade} status={trade.status} tab={tab} />;
  switch (trade.status) {
    case 'UNDER_PROPOSAL_REVIEW':
      return <HeldForReview trade={trade} />;
    case 'REJECTED':
      return <NotSent trade={trade} />;
    case 'PENDING_COUNTERPARTY':
      return mine ? <WaitingOnThem trade={trade} /> : <ClaimInvitation trade={trade} />;
    case 'AWAITING_ACCEPTANCE':
      if (trade.awaiting !== 'YOU') return <WaitingOnThem trade={trade} />;
      // A buyer's request (F-018) has its own two screens: the seller completing it, then the buyer reviewing it.
      if (
        trade.initiatorRole === 'BUYER' &&
        trade.yourRole === 'SELLER' &&
        isRequestSpec(trade.terms?.itemSpec)
      )
        return <SellerRequest trade={trade} />;
      if (
        trade.initiatorRole === 'BUYER' &&
        trade.yourRole === 'BUYER' &&
        isRequestShaped(trade.terms?.itemSpec)
      )
        return <ReviewAccept trade={trade} />;
      // A seller's finished offer (F-019): the buyer chooses how to receive it, then reviews and accepts.
      if (trade.yourRole === 'BUYER' && isSellerOffer(trade.initiatorRole, trade.terms?.itemSpec))
        return <BuyerChoose trade={trade} />;
      return <AnswerProposal trade={trade} />;
    case 'EXPIRED':
      // EX-01: an agreement that was accepted and never funded. An invitation that lapsed is the plain closed screen.
      return trade.acceptedAt === null ? <Closed trade={trade} /> : <TradeExpired trade={trade} />;
    case 'CANCELLED':
      // CT2: an agreement that was withdrawn before it was funded. A proposal withdrawn earlier is the plain closed screen.
      return trade.acceptedAt === null ? (
        <Closed trade={trade} />
      ) : (
        <ScreenColumn>
          <ScreenHeader title={trade.tradeCode} backHref="/trades" backLabel="Back to your trades" />
          <TradeCancelled trade={trade} />
        </ScreenColumn>
      );
    case 'DECLINED':
      return <Closed trade={trade} />;
    default:
      return <MovedOn trade={trade} />;
  }
}

// ---------------------------------------------------------------------------
// R1 and Customer-2: a proposal waiting on you
// ---------------------------------------------------------------------------

function AnswerProposal({ trade }: { trade: TradeView }): React.JSX.Element {
  const selling = trade.yourRole === 'SELLER';
  const accept = useAcceptTrade();
  const decline = useDeclineTrade();
  // The standard this trade froze, by its own id: still the one it froze after a newer one is published.
  const standard = usePinnedStandard(selling ? trade.standardVersionId : null);
  const queryClient = useQueryClient();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [proof, setProof] = useState<string[]>([]);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // What that standard asks for. A trade with no standard states no requirement and the platform decides;
  // one whose standard cannot be read is an error, never a reason to ask for less.
  const needs =
    standard.data === undefined ? { photos: 0, video: false } : proofNeeds(standard.data.proofMedia);
  const standardReady = !selling || trade.standardVersionId === null || standard.isSuccess;
  const [counts, setCounts] = useState({ photos: 0, videos: 0 });
  const proofMet = counts.photos >= needs.photos && (!needs.video || counts.videos >= 1);
  const ready = trade.terms !== null && addressId !== null && standardReady && proofMet;

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
      {
        onError: (error) => {
          setProblem(problemMessage(error, "We couldn't accept that. Try again."));
          // A stale terms version: show the latest, so the next try accepts what is on screen.
          if (isProblem(error, 'CONFLICT'))
            void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id) });
        },
      },
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
    <ProposeWorkspace
      header={<ScreenHeader title={selling ? 'New Request' : 'Review terms'} backHref="/trades" />}
    >
      <NoteBanner>
        {selling
          ? 'A buyer wants this from you. Review the terms, then accept, change them or decline.'
          : 'A seller proposed these terms. Review them, then accept, change them or decline.'}
      </NoteBanner>
      <ItemSummary trade={trade} />
      <PartyHeader trade={trade} />
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
          {standard.isError && (
            <RiskBanner title="Couldn't load what proof this trade needs">
              <button type="button" className="underline" onClick={() => void standard.refetch()}>
                Try again
              </button>
            </RiskBanner>
          )}
          {standard.isPending && trade.standardVersionId !== null && (
            <p role="status" className="mb-[12px] text-[12px] text-slate">
              Loading what proof this trade needs…
            </p>
          )}
          {standardReady && (
            <ProofUpload
              required={needs.photos}
              requireVideo={needs.video}
              onChange={(ids, summary) => {
                setProof(ids);
                setCounts(summary);
              }}
              step="accept"
            />
          )}
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
    </ProposeWorkspace>
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
    <ScreenColumn>
      <StatusHero tone="info" title={invited ? 'Invitation waiting' : 'Request sent'}>
        {invited
          ? "They're not on Komtru yet. When they sign up with the phone number or email you used, this request is waiting for them."
          : "They've been notified. You'll see their answer here, and you can change your mind until they accept."}
      </StatusHero>
      <ItemSummary trade={trade} />
      <CodeCard label="Trade Code" code={trade.tradeCode} />
      <ShareTrade shareUrl={trade.shareUrl} code={trade.tradeCode} />
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
    </ScreenColumn>
  );
}

function ClaimInvitation({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title="You're invited" backHref="/trades" />
      <NoteBanner>
        Someone invited you to this trade. Take your place in it to see the terms and answer.
      </NoteBanner>
      <ItemSummary trade={trade} />
      <ClaimPanel tradeId={trade.id} role={trade.yourRole} />
    </ScreenColumn>
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
    <ScreenColumn>
      <StatusHero tone="info" title="Held for review">
        The other party hasn&apos;t seen this yet. We&apos;re checking it before it&apos;s forwarded, and
        you&apos;ll see it move on here as soon as it&apos;s cleared.
      </StatusHero>
      <NoteBanner>
        This isn&apos;t a judgment about you. Some proposals are checked first, and yours is one of them.
      </NoteBanner>
      <CodeCard label="Your Trade Code. Save this either way" code={trade.tradeCode} />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </ScreenColumn>
  );
}

/** IF1's shape for the other state a review can end in: not forwarded, and the trade cannot continue. */
function NotSent({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title="Not sent" backHref="/trades" />
      <StatusHero tone="risk" as="h2" title="This proposal can't go ahead" className="pt-[8px]">
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
    </ScreenColumn>
  );
}

// ---------------------------------------------------------------------------
// The ends that are not an agreement
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
    <ScreenColumn>
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
    </ScreenColumn>
  );
}

function MovedOn({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title={trade.tradeCode} backHref="/trades" />
      <ItemSummary trade={trade} />
      <TermsRows trade={trade} />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </ScreenColumn>
  );
}
