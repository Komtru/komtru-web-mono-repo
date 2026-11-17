import type { EvidenceEvent } from '@komtru/api-client';

/** The reference's words for each event, and the order its category list and media groups draw them in. */
export const EVENT_LABEL: Record<EvidenceEvent, string> = {
  INSPECTION: 'Inspection',
  DISPATCH: 'Dispatch',
  DELIVERY: 'Delivery',
  ISSUE: 'Issue',
};

export const EVENT_ORDER: readonly EvidenceEvent[] = ['INSPECTION', 'DISPATCH', 'DELIVERY', 'ISSUE'];
