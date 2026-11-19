'use client';

// PM-6 and PM-8: what the Trade holds as evidence. `Trail` is the body of the evidence page (F-028 hosts it at
// `/trade/[id]/evidence`): the seller's proof as it was when the Trade was agreed and what was added beside it, each
// group saying who added it and when. `TradeRecord` (PM-8) is the same media after completion. Both read what the
// platform recorded and draw nothing it did not: no hub scans, no inspection photos, no retention period.
import type { TradeView } from '@komtru/api-client';
import { useInspection } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  Chip,
  NoteBanner,
  SectionLabel,
  Skeleton,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { ItemSummary } from '../parts';
import { ReadFailed, Frame, Refusal, TradeGate } from '../delivery/parts';
import { whenLabel } from '../format';
import { EVIDENCE_STATUSES, evidenceHref } from '../workspace-state';
import { EvidenceGroup } from '../delivery/EvidenceGroup';
import { type GridItem, MediaGrid } from './MediaGrid';

type Read = NonNullable<ReturnType<typeof useInspection>['data']>;

const COMPLETE = new Set(['COMPLETED', 'SETTLED', 'RESOLVED_REFUNDED', 'RESOLVED_RELEASED']);

const SIGNAL: Record<string, string> = {
  SELLER_SELF_REPORT: 'Reported delivered by the seller',
  BUYER_CONFIRMATION: 'Confirmed by the buyer',
};

const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;
const CAPTION = 'mt-[6px] mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray';

const proofItems = (read: Read): GridItem[] =>
  (read.sellerProof?.media ?? []).map((file, index) => ({
    id: file.fileId,
    fileId: file.fileId,
    label: `Seller’s proof ${String(index + 1)}`,
  }));

/** The seller's proof as it was when the Trade was agreed. `heading` is off where a panel already names it. */
export function SellerProofSection({
  trade,
  read,
  heading = true,
}: {
  trade: TradeView;
  read: Read;
  heading?: boolean;
}): React.JSX.Element {
  const proof = proofItems(read);
  return (
    <section aria-label="Seller’s proof">
      {heading && <SectionLabel>Seller’s proof</SectionLabel>}
      <div className="mb-[6px]">
        <Chip tone="verified">Shown when the Trade was agreed</Chip>
      </div>
      {proof.length === 0 ? (
        <p className="mt-[10px] mb-[14px] text-[12px] text-slate">
          No proof photos were attached to this trade.
        </p>
      ) : (
        <MediaGrid aria-label="Seller’s proof files" items={proof} className="mt-[10px]" />
      )}
      {trade.acceptedAt !== null && (
        <p className={CAPTION}>
          Agreed {whenLabel(trade.acceptedAt)}. Anything added after that is shown beside it, not over it.
        </p>
      )}
    </section>
  );
}

/** PM-6: what was shown, what was added and by whom. */
export function Trail({ trade, read }: { trade: TradeView; read: Read }): React.JSX.Element {
  return (
    <>
      <SellerProofSection trade={trade} read={read} />
      <AddedDuringTrade trade={trade} read={read} />
    </>
  );
}

/** What either side added once the Trade was running: dispatch, delivery, inspection and an issue, each its own group. */
export function AddedDuringTrade({ trade, read }: { trade: TradeView; read: Read }): React.JSX.Element {
  const shipment = read.deliveryEvidence.selfArranged;
  const signals = read.deliveryEvidence.signals ?? [];
  const seller = trade.yourRole === 'SELLER';
  // The waybill photo is the seller's own: the platform grants it to them only, so the buyer is told it is private.
  const receipt = seller ? shipment?.receiptFileId : undefined;
  return (
    <>
      <EvidenceGroup
        trade={trade}
        event="DISPATCH"
        heading="Added by the seller · dispatch"
        always={shipment !== null}
      >
        {shipment !== null && (
          <>
            {receipt !== undefined && (
              <MediaGrid
                aria-label="Dispatch files"
                items={[{ id: receipt, fileId: receipt, label: 'Waybill receipt' }]}
              />
            )}
            <p className={CAPTION}>
              Waybill {shipment.waybillNumber} · {whenLabel(shipment.shippedAt)}
              {receipt !== undefined
                ? ' · waybill photo included'
                : seller
                  ? ''
                  : ' · the waybill photo is kept private'}
            </p>
          </>
        )}
      </EvidenceGroup>

      <EvidenceGroup
        trade={trade}
        event="DELIVERY"
        heading="Added at delivery"
        empty={signals.length > 0 ? undefined : 'Nothing has been added at delivery yet.'}
        always
      >
        {signals.length > 0 && (
          <TermList aria-label="Delivery record">
            {signals.map((signal) => (
              <TermRow key={`${signal.source}-${signal.reportedAt ?? ''}`} label="Delivery">
                {SIGNAL[signal.source] ?? 'Delivery recorded'}
                {signal.reportedAt === undefined ? '' : ` · ${whenLabel(signal.reportedAt)}`}
              </TermRow>
            ))}
          </TermList>
        )}
      </EvidenceGroup>

      <EvidenceGroup
        trade={trade}
        event="INSPECTION"
        heading="Added at inspection"
        empty={
          seller
            ? 'Nothing has been added at inspection yet.'
            : 'Photos you add at inspection are kept here, with the trade.'
        }
        always
      />

      <EvidenceGroup trade={trade} event="ISSUE" heading="Added for an issue" />
      <NoteBanner>
        Chat attachments can be linked to the trade, but case evidence should be submitted through the
        evidence flow.
      </NoteBanner>
    </>
  );
}

/** PM-8: what the Trade holds once it is complete, by event, with a glance at the seller's proof. */
export function KeptSummary({
  trade,
  read,
  heading = true,
}: {
  trade: TradeView;
  read: Read;
  heading?: boolean;
}): React.JSX.Element {
  const proof = proofItems(read);
  const shipment = read.deliveryEvidence.selfArranged;
  const signals = read.deliveryEvidence.signals ?? [];
  const seller = trade.yourRole === 'SELLER';
  return (
    <>
      {heading && <SectionLabel>Evidence kept with this Trade</SectionLabel>}
      <TermList aria-label="Evidence kept with this Trade">
        <TermRow label="Seller’s proof">
          {proof.length === 0 ? 'None attached' : count(proof.length, 'photo or video', 'photos or videos')}
        </TermRow>
        {shipment !== null && (
          <TermRow label="Dispatch">
            {seller && shipment.receiptFileId !== undefined ? '1 photo · waybill' : 'Waybill noted'}
          </TermRow>
        )}
        {signals.length > 0 && (
          <TermRow label="Delivery">{count(signals.length, 'record', 'records')}</TermRow>
        )}
      </TermList>
      {proof.length > 0 && (
        <MediaGrid aria-label="Seller’s proof files" items={proof.slice(0, 4)} columns={4} />
      )}
    </>
  );
}

/** PM-8: after completion, the media kept with the Trade. */
export function TradeRecord({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title="Trade Record">
      {(trade) => <Record trade={trade} />}
    </TradeGate>
  );
}

function Record({ trade }: { trade: TradeView }): React.JSX.Element {
  const title = 'Trade Record';
  const readable = (EVIDENCE_STATUSES as readonly string[]).includes(trade.status);
  const complete = COMPLETE.has(trade.status);
  const inspection = useInspection(trade.id, readable && complete);
  if (!complete) {
    return (
      <Frame title={title} id={trade.id}>
        <NoteBanner title="The record is there once the Trade is complete">
          Until then, what the Trade holds so far is on its evidence page.
        </NoteBanner>
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={evidenceHref(trade.id)}>View all evidence</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  if (!readable)
    return <Refusal id={trade.id} title={title} why="There is no evidence recorded for this Trade." />;
  if (inspection.isPending) {
    return (
      <Frame title={title} id={trade.id}>
        <Skeleton width="full" lines={4} />
      </Frame>
    );
  }
  if (inspection.isError) {
    return (
      <ReadFailed error={inspection.error} noun="the record" onRetry={() => void inspection.refetch()} />
    );
  }
  const read = inspection.data;
  const refunded = trade.status.includes('REFUNDED');
  return (
    <Frame title={title} id={trade.id}>
      <ItemSummary trade={trade} />
      <div className="mb-[4px]">
        <Chip tone="verified">{refunded ? 'Refund decided' : 'Completed'}</Chip>
      </div>
      <KeptSummary trade={trade} read={read} />
      <NoteBanner>
        These files are held privately with the Trade. They aren’t made public, and they’re shared only with
        the people in it.
      </NoteBanner>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={evidenceHref(trade.id)}>View all evidence</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={`/trade/${trade.id}/documents`}>Receipt &amp; documents</a>
        </Button>
        <Button asChild variant="ghost">
          <a href="/trades" className="mx-auto block text-center">
            Back to Trades
          </a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
