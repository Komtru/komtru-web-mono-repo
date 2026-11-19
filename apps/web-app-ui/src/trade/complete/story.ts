import type { TradeActivityItem } from '@komtru/shared-types';
import type { VersionStep } from '@komtru/ui-kit';
import { whenLabel } from '../format';

/**
 * What the trade's own record says happened, oldest first, from `GET /trades/:id/activity`. A line is drawn only
 * for an event the platform recorded: how delivery ended (confirmed, assumed, or an inspection window that ran
 * out) and whether a dispute decided it are never guessed from the trade ending up complete.
 */
export interface Story {
  steps: VersionStep[];
  /** `resolved`: a dispute decided it, so the amount that moved is the case's and not the agreed price. */
  how: 'released' | 'resolved';
}

const at = (item: TradeActivityItem): string => whenLabel(item.occurredAt);

export function storyOf(
  activity: readonly TradeActivityItem[],
  agreement: { versionNumber: number } | null,
  settled: boolean,
): Story {
  const ordered = [...activity].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const first = (kind: TradeActivityItem['kind']) => ordered.find((item) => item.kind === kind);
  const steps: VersionStep[] = [
    {
      id: 'agreement',
      title: 'Agreement',
      ...(agreement === null ? {} : { detail: `Version ${String(agreement.versionNumber)}` }),
      state: 'done',
    },
  ];
  const funded = first('FUNDS_PROTECTED');
  if (funded !== undefined) {
    steps.push({ id: 'funded', title: 'Funds protected', detail: at(funded), state: 'done' });
  }
  const confirmed = first('DELIVERY_CONFIRMED');
  const assumed = first('DELIVERY_ASSUMED');
  const elapsed = first('INSPECTION_ELAPSED');
  if (confirmed !== undefined) {
    steps.push({
      id: 'delivery',
      title: 'Delivery confirmed',
      detail: `${confirmed.actor === 'YOU' ? 'By you' : confirmed.actor === 'KOMTRU' ? 'By Komtru' : 'By the other party'} · ${at(confirmed)}`,
      state: 'done',
    });
  } else if (assumed !== undefined) {
    steps.push({ id: 'delivery', title: 'Delivery assumed', detail: at(assumed), state: 'done' });
  }
  if (elapsed !== undefined) {
    steps.push({ id: 'inspection', title: 'Inspection window ended', detail: at(elapsed), state: 'done' });
  }
  const resolved = first('DISPUTE_RESOLVED');
  if (resolved !== undefined) {
    steps.push({ id: 'dispute', title: 'Dispute resolved', detail: at(resolved), state: 'done' });
  }
  const released = first('SETTLED');
  steps.push(
    settled
      ? {
          id: 'released',
          title: 'Payment released',
          ...(released === undefined ? {} : { detail: at(released) }),
          state: 'done',
        }
      : { id: 'released', title: 'Payment release', detail: 'Not confirmed yet', state: 'active' },
  );
  return { steps, how: resolved === undefined ? 'released' : 'resolved' };
}
