'use client';

// The one entry point the dispute routes go through. Two jobs, both of which every dispute screen
// would otherwise repeat:
//
//  1. Find the case. Every dispute route is addressed by TRADE id, as the reference's URLs are
//     (`/trade/88213/dispute`), but the platform's dispute endpoints are addressed by case id.
//     This reads the trade's case once and hands the id down.
//  2. Pick the side. The reference draws the buyer's and the seller's dispute screens separately
//     (Customer-7/8 against Seller-7/8), and which one a person gets is decided by the trade they
//     are a party to, never by the address — so there is no URL a seller can type to reach the
//     buyer's report form.
import { useTradeDispute } from '@komtru/api-client/react';
import { useTrade } from '@komtru/api-client/react';
import { LoadingScreen } from '@komtru/ui-kit';
import { Frame, ReadFailed, Refusal } from '../delivery/parts';
import { isProblem } from '../format';
import { Appeal } from './Appeal';
import { CaseStatus } from './CaseStatus';
import { EvidenceComparison } from './EvidenceComparison';
import { IssueReview } from './IssueReview';
import { ReportIssue } from './ReportIssue';
import { SellerNotice } from './SellerNotice';
import { Withdraw } from './Withdraw';

/**
 * `/trade/:id/dispute`. Before a case exists this is the buyer's report form and the seller has
 * nothing to see; once one exists it is the notice (seller) or the status (buyer).
 */
export function DisputeScreen({ id }: { id: string }): React.JSX.Element {
  const trade = useTrade(id);
  const dispute = useTradeDispute(id);
  const title = 'Dispute';

  if (trade.isPending || dispute.isPending) {
    return (
      <Frame title={title} id={id}>
        <LoadingScreen label="Loading the trade" />
      </Frame>
    );
  }
  if (trade.isError) {
    if (isProblem(trade.error, 'NOT_FOUND')) {
      return <Refusal id={id} title={title} why="We can’t find that trade." />;
    }
    return (
      <Frame title={title} id={id}>
        <ReadFailed error={trade.error} noun="this trade" onRetry={() => void trade.refetch()} />
      </Frame>
    );
  }
  if (dispute.isError) {
    return (
      <Frame title={title} id={id}>
        <ReadFailed error={dispute.error} noun="this case" onRetry={() => void dispute.refetch()} />
      </Frame>
    );
  }

  const open = dispute.data;
  const seller = trade.data.yourRole === 'SELLER';

  if (open === null) {
    // No case yet. The buyer can open one; the seller has nothing to answer.
    return seller ? (
      <Refusal
        id={id}
        title={title}
        why="There is no issue open on this trade. If something has gone wrong on your side, open a support ticket."
      />
    ) : (
      <ReportIssue id={id} />
    );
  }

  return seller ? <SellerNotice id={id} disputeId={open.id} /> : <CaseStatus id={id} disputeId={open.id} />;
}

/**
 * The case screens a route can draw. The route names one by key: a server page cannot pass a component
 * or a render function into this client module (React cannot serialise a function across that boundary),
 * so the choice is made here, from a string.
 */
export type CaseScreen = 'issue' | 'status' | 'evidence' | 'withdraw' | 'appeal';

type CaseScreenProps = { id: string; disputeId?: string };

const CASE_SCREENS: Record<
  CaseScreen,
  { title: string; Screen: (props: CaseScreenProps) => React.JSX.Element }
> = {
  issue: { title: 'Report an Issue', Screen: IssueReview },
  status: { title: 'Dispute', Screen: CaseStatus },
  evidence: { title: 'Evidence', Screen: EvidenceComparison },
  withdraw: { title: 'Withdraw', Screen: Withdraw },
  appeal: { title: 'File an Appeal', Screen: Appeal },
};

/**
 * The shape every other dispute route shares: read the trade's case id, then draw. A route that
 * needs the case and finds none says so rather than rendering an empty screen.
 */
export function WithDispute({ id, screen }: { id: string; screen: CaseScreen }): React.JSX.Element {
  const { title, Screen } = CASE_SCREENS[screen];
  const dispute = useTradeDispute(id);

  if (dispute.isPending) {
    return (
      <Frame title={title} id={id}>
        <LoadingScreen label="Loading the case" />
      </Frame>
    );
  }
  if (dispute.isError) {
    return (
      <Frame title={title} id={id}>
        <ReadFailed error={dispute.error} noun="this case" onRetry={() => void dispute.refetch()} />
      </Frame>
    );
  }
  if (dispute.data === null) {
    return <Refusal id={id} title={title} why="There is no issue open on this trade." />;
  }
  return <Screen id={id} disputeId={dispute.data.id} />;
}
