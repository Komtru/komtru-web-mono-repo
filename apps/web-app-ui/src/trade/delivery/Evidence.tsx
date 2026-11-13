'use client';

import type { TradeView } from '@komtru/api-client';
import { useInspection } from '@komtru/api-client/react';
import { ActionStack, Button, NoteBanner, SectionLabel, Skeleton } from '@komtru/ui-kit';
import { ProofTile } from '../inspection/Proof';
import { EVIDENCE_STATUSES } from '../workspace-state';
import { ReadFailed, Frame, Refusal, TradeGate, tradeHref } from './parts';

const TITLE = 'Trade Evidence';

interface Group {
  event: string;
  files: { fileId: string; label: string }[];
  /** Said when the group has no files: what is true, not a promise. */
  empty: string;
}

/**
 * CWT-S12 (Z4): the media kept with the trade, by event. Only what the platform can list is drawn: the seller's
 * proof photos (Listing) and, for the seller, the waybill receipt (Dispatch). Media from delivery and inspection
 * have no read yet, so those groups say so plainly rather than show a count the platform did not give.
 */
export function Evidence({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {(trade) => <Media trade={trade} />}
    </TradeGate>
  );
}

function Media({ trade }: { trade: TradeView }): React.JSX.Element {
  const readable = (EVIDENCE_STATUSES as readonly string[]).includes(trade.status);
  const inspection = useInspection(trade.id, readable);
  if (!readable) {
    return (
      <Refusal
        id={trade.id}
        title={TITLE}
        why="Evidence appears here once the item has shipped. Nothing has been recorded yet."
      />
    );
  }
  if (inspection.isPending) {
    return (
      <Frame title={TITLE} id={trade.id}>
        <Skeleton width="full" lines={4} />
      </Frame>
    );
  }
  if (inspection.isError) {
    return (
      <ReadFailed error={inspection.error} noun="the evidence" onRetry={() => void inspection.refetch()} />
    );
  }
  const read = inspection.data;
  const proof = read.sellerProof?.media ?? [];
  const receipt = read.deliveryEvidence.selfArranged?.receiptFileId;
  const seller = trade.yourRole === 'SELLER';
  const groups: Group[] = [
    {
      event: 'Listing',
      files: proof.map((item, index) => ({
        fileId: item.fileId,
        label: `Listing photo ${String(index + 1)}`,
      })),
      empty: 'No proof photos were attached to this trade.',
    },
    {
      event: 'Dispatch',
      files: seller && receipt !== undefined ? [{ fileId: receipt, label: 'Waybill receipt' }] : [],
      empty: seller ? 'No waybill receipt is recorded.' : 'The seller’s waybill receipt is kept private.',
    },
    { event: 'Delivery', files: [], empty: 'No files recorded for delivery.' },
    { event: 'Inspection', files: [], empty: 'No files recorded for inspection.' },
  ];
  return (
    <Frame title={TITLE} id={trade.id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        Browse media by event. Evidence stays associated with the trade and, where relevant, the linked case.
      </p>
      {groups.map((group) => (
        <section key={group.event} aria-label={group.event}>
          <SectionLabel>
            {group.event} · {String(group.files.length)} {group.files.length === 1 ? 'file' : 'files'}
          </SectionLabel>
          {group.files.length === 0 ? (
            <p className="mb-[14px] text-[12px] text-slate">{group.empty}</p>
          ) : (
            <ul className="mb-[14px] grid list-none grid-cols-3 gap-[8px] p-0">
              {group.files.map((file) => (
                <li key={file.fileId}>
                  <ProofTile fileId={file.fileId} label={file.label} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <NoteBanner>
        Chat attachments can be linked to the trade, but case evidence should be submitted through the
        evidence flow.
      </NoteBanner>
      <ActionStack className="mt-[16px]">
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
