'use client';

import type { TradeView } from '@komtru/api-client';
import { useInspection } from '@komtru/api-client/react';
import { ActionStack, Button, Skeleton } from '@komtru/ui-kit';
import { Trail } from '../proof/EvidenceTrail';
import { EvidenceAcross } from '../proof/EvidenceStates';
import { useViewport } from '../workspace/viewport';
import { EVIDENCE_OPEN_STATUSES } from '@komtru/api-client';
import { EVIDENCE_STATUSES, addEvidenceHref } from '../workspace-state';
import { ReadFailed, Frame, Refusal, TradeGate, tradeHref } from './parts';

const TITLE = 'Trade Evidence';

/**
 * CWT-S12 / PM-6 (Z4): the media kept with the trade, by event, drawn by F-029's `Trail`. Only what the platform can
 * Only what the platform lists is shown: the seller's proof, the dispatch record (and, for the seller, the waybill
 * photo), the delivery records, and the media either side added under dispatch, delivery, inspection or an issue
 * (CWT-S13), read per event, each group with its own loading, empty and failed states.
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
  const viewport = useViewport();
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
      <Frame title={TITLE} id={trade.id} wide>
        <Skeleton width="full" lines={4} />
      </Frame>
    );
  }
  if (inspection.isError) {
    return (
      <ReadFailed error={inspection.error} noun="the evidence" onRetry={() => void inspection.refetch()} />
    );
  }
  return (
    <Frame title={TITLE} id={trade.id} wide>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        What was shown, what was added and by whom. Evidence stays associated with the trade and, where
        relevant, the linked case.
      </p>
      {viewport === 'mobile' ? (
        <Trail trade={trade} read={inspection.data} />
      ) : (
        <EvidenceAcross trade={trade} read={inspection.data} viewport={viewport} />
      )}
      <ActionStack className="mt-[16px] md:flex-row md:justify-end">
        {(EVIDENCE_OPEN_STATUSES as readonly string[]).includes(trade.status) && (
          <Button asChild className="md:w-auto! md:px-[22px]">
            <a href={addEvidenceHref(trade.id)}>Add evidence</a>
          </Button>
        )}
        <Button asChild variant="secondary" className="md:w-auto! md:px-[22px]">
          <a href={tradeHref(trade.id)}>Back to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
