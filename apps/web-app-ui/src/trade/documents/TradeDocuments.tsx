'use client';

import type { TradeView } from '@komtru/api-client';
import { useInspection } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  Chip,
  InfoCard,
  InfoRow,
  NoteBanner,
  SectionLabel,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { Frame, Refusal, SubReadFailed, TradeGate } from '../delivery/parts';
import { naira, whenLabel } from '../format';
import { ItemSummary } from '../parts';
import { agreementHref } from '../terms/routes';
import { EVIDENCE_STATUSES } from '../workspace-state';

/** A Trade whose records are final: what the reference means by "completed". The same set the Trade Record uses. */
const COMPLETE = new Set(['COMPLETED', 'SETTLED', 'RESOLVED_REFUNDED', 'RESOLVED_RELEASED']);

export const documentsHref = (tradeId: string): string => `/trade/${tradeId}/documents`;
const recordHref = (tradeId: string): string => `/trade/${tradeId}/record`;

const DOC = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3.5h7l4 4V20.5H7z" />
    <path d="M10 12h5M10 15.5h5" />
  </svg>
);

const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** SP-M11: what a completed Trade leaves you with, for either side of it. */
export function TradeDocuments({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title="Documents">
      {(trade) => <Documents trade={trade} />}
    </TradeGate>
  );
}

/**
 * Three documents and where each lives. The agreement is the Trade's own agreement screen and the delivery proof is its
 * record. The receipt is the Trade's fee snapshot, drawn here and printed or saved as a PDF by the browser: the platform
 * makes no PDFs, holds no retention period it states, and has no sharing, so the reference's "(PDF)", "kept for 12 months",
 * "Download all" and "Share" are not here.
 */
function Documents({ trade }: { trade: TradeView }): React.JSX.Element {
  const complete = COMPLETE.has(trade.status);
  const readable = (EVIDENCE_STATUSES as readonly string[]).includes(trade.status);
  const inspection = useInspection(trade.id, readable && complete);

  if (!complete) {
    return (
      <Frame title="Documents" id={trade.id}>
        <NoteBanner title="Documents are there once the Trade is complete">
          Until then, the agreed terms are on the Trade’s agreement screen.
        </NoteBanner>
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={agreementHref(trade.id)}>View the agreement</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  if (trade.terms === null) {
    return (
      <Refusal id={trade.id} title="Documents" why="This Trade has no agreed terms to make documents from." />
    );
  }

  const refunded = trade.status.includes('REFUNDED');
  const proofCount = inspection.data?.sellerProof?.media.length ?? 0;
  const deliveryRecords = inspection.data?.deliveryEvidence.signals?.length ?? 0;
  const proofDetail = inspection.isPending
    ? 'Loading…'
    : inspection.isError
      ? 'Couldn’t be read just now'
      : [
          proofCount === 0 ? 'No photos attached' : count(proofCount, 'photo or video', 'photos or videos'),
          deliveryRecords === 0 ? '' : count(deliveryRecords, 'delivery record', 'delivery records'),
        ]
          .filter((part) => part !== '')
          .join(' · ');

  return (
    <Frame title="Documents" id={trade.id}>
      <ItemSummary trade={trade} />
      <div className="mb-[4px]">
        <Chip tone="verified">{refunded ? 'Refund decided' : 'Completed'}</Chip>
        <span className="ml-[8px] font-mono text-[11.5px] text-slate">{trade.tradeCode}</span>
      </div>
      {refunded && (
        <NoteBanner>
          This Trade ended with a refund decision. The receipt shows what was agreed; where the money is, is
          on{' '}
          <a href="/account/refunds" className="font-semibold text-info-on-soft">
            Where’s my refund?
          </a>
        </NoteBanner>
      )}
      <SectionLabel>Documents</SectionLabel>
      <InfoCard aria-label="Documents for this Trade">
        <InfoRow
          icon={DOC}
          title="Agreement"
          detail={`Version ${String(trade.terms.versionNumber)}${
            trade.acceptedAt === null ? '' : ` · agreed ${whenLabel(trade.acceptedAt)}`
          }`}
          href={agreementHref(trade.id)}
        />
        <InfoRow icon={DOC} title="Receipt" detail="Below · print it or save it as a PDF" />
        <InfoRow icon={DOC} title="Delivery proof" detail={proofDetail} href={recordHref(trade.id)} />
      </InfoCard>
      {inspection.isError && readable && (
        <SubReadFailed noun="the delivery proof" onRetry={() => void inspection.refetch()} />
      )}
      <Receipt trade={trade} />
    </Frame>
  );
}

/** The Trade's fee snapshot, as the platform recorded it when the Trade was agreed. Nothing is added up here. */
function Receipt({ trade }: { trade: TradeView }): React.JSX.Element {
  const { fees } = trade;
  if (fees === null) {
    return (
      <section aria-label="Receipt" className="mt-[16px]">
        <SectionLabel>Receipt</SectionLabel>
        <NoteBanner>The receipt isn’t available for this Trade.</NoteBanner>
      </section>
    );
  }
  const buyer = trade.yourRole === 'BUYER';
  return (
    <section aria-label="Receipt" className="mt-[16px]">
      <SectionLabel>Receipt</SectionLabel>
      <TermList aria-label="Receipt figures">
        <TermRow label="Trade Code">{trade.tradeCode}</TermRow>
        {trade.acceptedAt !== null && <TermRow label="Agreed">{whenLabel(trade.acceptedAt)}</TermRow>}
        <TermRow label="Item">{naira(fees.itemAmountMinor)}</TermRow>
        {buyer ? (
          <>
            <TermRow label="Buyer protection fee">{naira(fees.buyerProtectionFeeMinor)}</TermRow>
            <TermRow label="You paid">{naira(fees.buyerTotalMinor)}</TermRow>
          </>
        ) : (
          <>
            {fees.commissionMinor !== '0' && (
              <TermRow label="Komtru’s fee">{naira(fees.commissionMinor)}</TermRow>
            )}
            <TermRow label="You receive">{naira(fees.sellerProceedsMinor)}</TermRow>
          </>
        )}
      </TermList>
      <ActionStack>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            window.print();
          }}
        >
          Print or save as PDF
        </Button>
      </ActionStack>
    </section>
  );
}
