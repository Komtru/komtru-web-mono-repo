'use client';

// CWT-S12's groups for the media the parties added (F-028): one component per event, each with its own loading,
// empty and failed states, so a failed read of one group is never drawn as "no files" and never takes the others down.
import type { EvidenceEvent, TradeView } from '@komtru/api-client';
import { useTradeEvidence } from '@komtru/api-client/react';
import { SectionLabel, Skeleton } from '@komtru/ui-kit';
import { type GridItem, MediaGrid } from '../proof/MediaGrid';
import { EVENT_LABEL } from './evidence-events';
import { SubReadFailed } from './parts';

const CAPTION = 'mt-[6px] mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray';
const count = (n: number): string => `${String(n)} ${n === 1 ? 'file' : 'files'}`;

export interface EvidenceGroupProps {
  trade: TradeView;
  event: EvidenceEvent;
  /** The group's heading, in the words the screen already uses for it. */
  heading: string;
  /** Said when nothing was added. Without it the group is not drawn at all while it is empty. */
  empty?: string;
  /** Content the screen already has for this event (the waybill, the delivery record), drawn above the files. */
  children?: React.ReactNode;
  /** The event has something to say even with no files, so the group is drawn regardless. */
  always?: boolean;
}

export function EvidenceGroup({
  trade,
  event,
  heading,
  empty,
  children,
  always = false,
}: EvidenceGroupProps): React.JSX.Element | null {
  const media = useTradeEvidence(trade.id, event, true);
  const shown = always || empty !== undefined || children !== undefined;
  const label = EVENT_LABEL[event].toLowerCase();

  if (media.isPending) {
    if (!shown) return null;
    return (
      <section aria-label={EVENT_LABEL[event]} aria-busy>
        <SectionLabel>{heading}</SectionLabel>
        {children}
        <Skeleton width="full" lines={3} />
      </section>
    );
  }
  if (media.isError) {
    return (
      <section aria-label={EVENT_LABEL[event]}>
        <SectionLabel>{heading}</SectionLabel>
        {children}
        <SubReadFailed noun={`the ${label} files`} onRetry={() => void media.refetch()} />
      </section>
    );
  }
  const items: GridItem[] = media.data.items.map((file, index) => ({
    id: file.id,
    fileId: file.fileId,
    label: `${EVENT_LABEL[event]} file ${String(index + 1)}, added by the ${file.attachedByRole === 'BUYER' ? 'buyer' : 'seller'}`,
  }));
  if (items.length === 0 && !shown) return null;
  return (
    <section aria-label={EVENT_LABEL[event]}>
      <SectionLabel>{heading}</SectionLabel>
      {children}
      {items.length > 0 ? (
        <>
          <MediaGrid aria-label={`${EVENT_LABEL[event]} files`} items={items} className="mt-[10px]" />
          <p className={CAPTION}>{count(items.length)} · shared with both sides of the trade</p>
        </>
      ) : (
        empty !== undefined && <p className="mt-[10px] mb-[14px] text-[12px] text-slate">{empty}</p>
      )}
    </section>
  );
}
