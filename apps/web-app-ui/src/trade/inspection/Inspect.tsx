'use client';

import type { TradeView } from '@komtru/api-client';
import { useInspection, useRespondToInspectionExtension, useTrade } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  RiskBanner,
  ScreenHeader,
  SectionLabel,
  StatusHero,
  TermList,
  TermRow,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import {
  addressLine,
  hoursLabel,
  isProblem,
  nairaShort,
  partyName,
  platformWords,
  problemMessage,
} from '../format';
import { ItemSummary } from '../parts';
import { extensionPending, releasePaused } from '../workspace-copy';
import { Deadline } from '../workspace/shared';
import { InspectCompare, MatchChecks, MyPhotos } from '../proof/ProofReview';
import { TradeColumn, Panel } from '../workspace/layout';
import { useViewport } from '../workspace/viewport';
import { DeliveryEvidence, SellerProof } from './Proof';
import { MoreTimeSheet, ReleaseSheet } from './sheets';

const tradeHref = (id: string) => `/trade/${id}`;

type Read = NonNullable<ReturnType<typeof useInspection>['data']>;

function Frame({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <TradeColumn>
      <ScreenHeader title={title} backHref={tradeHref(id)} backLabel="Back to the trade" />
      {children}
    </TradeColumn>
  );
}

const BackLink = ({ id }: { id: string }): React.JSX.Element => (
  <ActionStack>
    <Button asChild variant="secondary">
      <a href={tradeHref(id)}>Back to the trade</a>
    </Button>
  </ActionStack>
);

/**
 * F-027 (Customer-4, Z4, Z5, BEI1, BEI2): Inspect & Confirm. The buyer compares the seller's proof with what the
 * platform recorded of the delivery, then confirms and releases (behind an acknowledgement) or asks for more time.
 * The seller sees the same trade and, when the buyer asked for more time, answers it here. Which of these shows
 * is the trade's status and the platform's own `canRequestMoreTime` / `canRespondToRequest`; nothing is decided
 * here from the clock.
 */
export function Inspect({ id }: { id: string }): React.JSX.Element {
  const trade = useTrade(id);
  const inspection = useInspection(id, trade.data !== undefined);

  if (trade.isPending) {
    return (
      <Frame title="Inspect & Confirm" id={id}>
        <LoadingScreen label="Loading the trade" />
      </Frame>
    );
  }
  if (trade.data === undefined) {
    return (
      <LoadFailed
        title="Couldn’t open this trade"
        body={problemMessage(trade.error, 'Check your connection and try again.')}
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }
  const view = trade.data;
  const buyer = view.yourRole === 'BUYER';
  const title = buyer ? 'Inspect & Confirm' : 'Inspection';

  if (view.status === 'COMPLETED' || view.status === 'SETTLED') {
    return (
      <Frame title={title} id={id}>
        <StatusHero
          tone="success"
          as="h2"
          title={buyer ? 'You released the payment' : 'The item was accepted'}
        >
          {buyer
            ? 'The item is confirmed. Komtru is paying the seller from the funds it held.'
            : 'The buyer confirmed the item. Komtru is carrying out your payout.'}
        </StatusHero>
        <BackLink id={id} />
      </Frame>
    );
  }
  if (view.status !== 'INSPECTION') {
    return (
      <Frame title={title} id={id}>
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          {view.status === 'SHIPPED' || view.status === 'UNCONFIRMED_DELIVERY'
            ? buyer
              ? 'Inspection starts when you confirm the item has arrived. Do that from the trade.'
              : 'Inspection starts when the buyer confirms the item has arrived.'
            : 'This trade isn’t being inspected right now.'}
        </p>
        <BackLink id={id} />
      </Frame>
    );
  }
  if (inspection.isPending) {
    return (
      <Frame title={title} id={id}>
        <LoadingScreen label="Loading the inspection" />
      </Frame>
    );
  }
  if (inspection.isError) {
    return (
      <Frame title={title} id={id}>
        <RiskBanner>
          {problemMessage(inspection.error, 'We couldn’t load the inspection. Try again.')}
        </RiskBanner>
        <ActionStack>
          <Button type="button" variant="secondary" onClick={() => void inspection.refetch()}>
            Try again
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  return buyer ? (
    <BuyerInspect trade={view} read={inspection.data} query={inspection} />
  ) : (
    <SellerInspect trade={view} read={inspection.data} query={inspection} />
  );
}

interface Parts {
  trade: TradeView;
  read: Read;
  query: ReturnType<typeof useInspection>;
}

/** The window and what each kind of silence means, shared by both sides. */
function Window({ read, query, buyer }: { read: Read; query: Parts['query']; buyer: boolean }) {
  return (
    <>
      <Deadline
        label="Inspection ends"
        noun="inspection deadline"
        query={query}
        at={read.window.deadlineAt}
      />
      <p className="mb-[14px] text-[11.5px] leading-[1.6] text-slate">
        {buyer
          ? `You have ${hoursLabel(read.window.hours)} to inspect${read.window.extended ? ', extended' : ''}. If you don’t respond by then, the payment is released to the seller automatically.`
          : `The buyer has ${hoursLabel(read.window.hours)} to inspect${read.window.extended ? ', extended' : ''}. If they don’t report an issue by then, the payment is released to you automatically.`}
      </p>
      {read.window.autoReleasePaused && (
        <WarnBanner title={releasePaused.title}>{releasePaused.body}</WarnBanner>
      )}
    </>
  );
}

/** Z4 and Z5, with BEI1. */
function BuyerInspect({ trade, read, query }: Parts): React.JSX.Element {
  const [releasing, setReleasing] = useState(false);
  const [asking, setAsking] = useState(false);
  const seller =
    trade.counterparty === undefined || trade.counterparty === null
      ? 'the seller'
      : partyName(trade.counterparty);
  const request = read.extensionRequest;
  const deliveredTo =
    trade.terms?.deliveryAddress === null || trade.terms === null
      ? undefined
      : addressLine(trade.terms.deliveryAddress);
  const viewport = useViewport();
  const checksNote = (
    <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
      Check the item against the agreed terms before confirming. Confirming releases the payment and can’t be
      undone.
    </p>
  );
  const delivery = (
    <>
      <SectionLabel>Delivery — what you received</SectionLabel>
      <DeliveryEvidence read={read} deliveredTo={deliveredTo} />
    </>
  );
  const wide = viewport !== 'mobile';
  // Wide: the buttons are as wide as their labels. A tablet pins them to the foot of the screen (TX-14); a desktop
  // draws them under the panels (DX-23).
  const grow = wide ? 'md:w-auto! md:px-[22px]' : '';
  const actions = (
    <>
      <Button
        type="button"
        className={grow}
        onClick={() => {
          setReleasing(true);
        }}
      >
        Confirm & Release Payment
      </Button>
      {read.canRequestMoreTime && (
        <Button
          type="button"
          variant="secondary"
          className={grow}
          onClick={() => {
            setAsking(true);
          }}
        >
          Ask for more time
        </Button>
      )}
      <Button asChild variant="secondary" className={grow}>
        <a href={tradeHref(trade.id)}>Back to the trade</a>
      </Button>
    </>
  );
  return (
    <Frame title="Inspect & Confirm" id={trade.id}>
      <Window read={read} query={query} buyer />
      {request?.status === 'PENDING' && (
        <NoteBanner title={extensionPending('BUYER').title}>{extensionPending('BUYER').body}</NoteBanner>
      )}
      {request?.status === 'ACCEPTED' && (
        <NoteBanner title="More time was agreed">
          The seller agreed, so your inspection window is longer. The new end time is above.
        </NoteBanner>
      )}
      {request?.status === 'DECLINED' && (
        <NoteBanner title="More time was declined">
          The seller declined, so the inspection ends as first agreed.
        </NoteBanner>
      )}
      {viewport === 'desktop' ? (
        // DX-23: what the seller showed beside what you received, so the decision is a comparison, not a memory.
        <div className="grid grid-cols-2 items-start gap-[16px]">
          <Panel title="What the seller showed">
            <ItemSummary trade={trade} />
            <SellerProof read={read} seller={seller} />
          </Panel>
          <Panel title="What you received">
            <MyPhotos />
            {delivery}
            <MatchChecks />
            {checksNote}
          </Panel>
        </div>
      ) : viewport === 'tablet' ? (
        // TX-14: the pills swap the seller's proof and your photos; the checks stay beside them.
        <div className="grid grid-cols-2 items-start gap-[16px]">
          <div className="min-w-0">
            <ItemSummary trade={trade} />
            <Panel title="Photos">
              <InspectCompare read={read} seller={seller} />
            </Panel>
            {delivery}
          </div>
          <Panel title="Checks">
            <MatchChecks heading={false} />
            {checksNote}
          </Panel>
        </div>
      ) : (
        <>
          <ItemSummary trade={trade} />
          <SectionLabel>Seller’s proof — before shipping</SectionLabel>
          <InspectCompare read={read} seller={seller} />
          {delivery}
          <MatchChecks />
          {checksNote}
        </>
      )}
      {wide ? (
        <div
          className={`mt-[16px] flex flex-wrap items-center gap-[10px] ${
            viewport === 'tablet'
              ? 'sticky bottom-0 z-10 -mx-[16px] border-0 border-t border-solid border-border-hairline bg-surface-primary px-[16px] py-[12px] md:justify-end'
              : ''
          }`}
        >
          {actions}
        </div>
      ) : (
        <ActionStack>{actions}</ActionStack>
      )}
      <p className="mt-[12px] text-[11.5px] leading-[1.6] text-trust-gray">
        Reporting an issue isn’t in the app yet.
      </p>
      <ReleaseSheet
        open={releasing}
        tradeId={trade.id}
        amount={trade.fees === null ? undefined : nairaShort(trade.fees.itemAmountMinor)}
        seller={seller}
        onClose={() => {
          setReleasing(false);
        }}
      />
      <MoreTimeSheet
        open={asking}
        tradeId={trade.id}
        windowHours={read.window.hours}
        onClose={() => {
          setAsking(false);
        }}
      />
    </Frame>
  );
}

/** BEI2: the seller sees the buyer's request in full, beside the standard it changes, and answers it. */
function SellerInspect({ trade, read, query }: Parts): React.JSX.Element {
  const respond = useRespondToInspectionExtension();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const request = read.extensionRequest;
  const answer = (decision: 'ACCEPT' | 'DECLINE') => {
    if (request === null) return;
    setProblem(undefined);
    respond.mutate(
      { id: trade.id, requestId: request.id, decision },
      {
        onError: (error) => {
          setProblem(platformWords(error, 'We couldn’t send your answer. Try again.'));
        },
      },
    );
  };
  return (
    <Frame title="Inspection" id={trade.id}>
      <Window read={read} query={query} buyer={false} />
      <ItemSummary trade={trade} />
      {read.canRespondToRequest && request !== null ? (
        <>
          <SectionLabel>The buyer wants more time</SectionLabel>
          <TermList aria-label="Request for more inspection time">
            <TermRow label="Inspection window">{hoursLabel(read.window.hours)} standard</TermRow>
            {request.extraHours !== undefined && (
              <TermRow label="Requested">{hoursLabel(request.extraHours)} more</TermRow>
            )}
            {typeof request.note === 'string' && request.note !== '' && (
              <TermRow label="Their note">{request.note}</TermRow>
            )}
          </TermList>
          <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
            Your funds stay just as protected either way. This only changes how long they’re held before
            release.
          </p>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <ActionStack>
            <Button
              type="button"
              disabled={respond.isPending}
              onClick={() => {
                answer('ACCEPT');
              }}
            >
              {respond.isPending
                ? 'Sending…'
                : request.extraHours === undefined
                  ? 'Accept'
                  : `Accept ${hoursLabel(request.extraHours)} more`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={respond.isPending}
              onClick={() => {
                answer('DECLINE');
              }}
            >
              Decline
            </Button>
          </ActionStack>
        </>
      ) : (
        <>
          <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
            {request?.status === 'ACCEPTED'
              ? 'You agreed to more inspection time. The window is extended.'
              : request?.status === 'DECLINED'
                ? 'You declined more inspection time. The window ends as first agreed.'
                : 'The buyer hasn’t asked for more time.'}
          </p>
          <BackLink id={trade.id} />
        </>
      )}
    </Frame>
  );
}
