'use client';

import type { TradeView } from '@komtru/api-client';
import { useInspection } from '@komtru/api-client/react';
import { ActionStack, Button, Skeleton } from '@komtru/ui-kit';
import { Trail } from '../proof/EvidenceTrail';
import { EVIDENCE_OPEN_STATUSES } from '@komtru/api-client';
import { EVIDENCE_STATUSES, addEvidenceHref } from '../workspace-state';
import { ReadFailed, Frame, Refusal, TradeGate, tradeHref } from './parts';

const TITLE = 'Trade Evidence';

/**
 * CWT-S12 / PM-6 (Z4): the media kept with the trade, by event, drawn by F-029's `Trail`. Only what the platform can
XX
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
  return (
    <Frame title={TITLE} id={trade.id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        What was shown, what was added and by whom. Evidence stays associated with the trade and, where
        relevant, the linked case.
      </p>
      <Trail trade={trade} read={inspection.data} />
      <ActionStack className="mt-[16px]">
        {(EVIDENCE_OPEN_STATUSES as readonly string[]).includes(trade.status) && (
          <Button asChild>
            <a href={addEvidenceHref(trade.id)}>Add evidence</a>
          </Button>
        )}
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
