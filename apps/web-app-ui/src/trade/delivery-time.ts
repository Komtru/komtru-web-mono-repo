// What the delivery deadline means to each side (DE1 to DE3), as pure data and rules, so the words and the "may
// the seller still ask" decision are tested without a DOM. The platform decides what is allowed (once per deadline,
// before it passes, not beyond one original window); this only decides what to SHOW from what it reported.
import type { DeliveryExtension, DeliveryExtensionReason } from '@komtru/api-client';
import type { TradeRole } from './workspace-state';

export const EXTENSION_REASONS: readonly { value: DeliveryExtensionReason; label: string }[] = [
  { value: 'COURIER_PICKUP_DELAYED', label: 'Courier pickup delayed' },
  { value: 'RESTOCKING_ITEM', label: 'Restocking the exact item' },
  { value: 'ADDRESS_OR_LOGISTICS_ISSUE', label: 'Address or logistics issue' },
];

export const reasonLabel = (reason: string | undefined): string =>
  EXTENSION_REASONS.find((item) => item.value === reason)?.label ?? 'Not given';

export interface DeadlineRead {
  deadline: { status: string; dueAt: string; extensionCount: number } | null;
  extensionRequest: Pick<DeliveryExtension, 'id' | 'status'> | null;
}

export type DeliveryTimeState =
  | { kind: 'none' }
  /** DE3: the date passed while the deadline is still open. */
  | { kind: 'overdue'; dueAt: string }
  /** DE2 for the buyer, a waiting note for the seller. */
  | { kind: 'request-pending' }
  | { kind: 'request-declined' }
  /** DE1's entry: the seller may still ask. */
  | { kind: 'can-ask' };

export function deliveryTimeState(read: DeadlineRead, role: TradeRole, now: Date): DeliveryTimeState {
  const { deadline, extensionRequest } = read;
  if (deadline === null || deadline.status !== 'PENDING') return { kind: 'none' };
  if (new Date(deadline.dueAt).getTime() <= now.getTime()) return { kind: 'overdue', dueAt: deadline.dueAt };
  if (extensionRequest?.status === 'PENDING') return { kind: 'request-pending' };
  if (extensionRequest?.status === 'DECLINED' && role === 'SELLER') return { kind: 'request-declined' };
  if (role === 'SELLER' && deadline.extensionCount === 0 && extensionRequest === null) {
    return { kind: 'can-ask' };
  }
  return { kind: 'none' };
}

/** DE3's words, by side and by whether the seller got as far as shipping. */
export function overdueWords(
  role: TradeRole,
  shipped: boolean,
  when: string,
  seller?: string,
): { title: string; body: string } {
  if (role === 'BUYER') {
    return shipped
      ? {
          title: 'Delivery is overdue',
          body: `The delivery date was ${when}. ${seller ?? 'The seller'} has shipped it. Your money stays protected while you wait.`,
        }
      : {
          title: 'Delivery is overdue',
          body: `The delivery date was ${when} and ${seller ?? 'the seller'} hasn’t shipped or asked for more time. Your money stays protected. If nothing is shipped, Komtru refunds you in full.`,
        };
  }
  return {
    title: 'Your delivery date has passed',
    body: shipped
      ? `The delivery date was ${when}. Report delivery once it has arrived so the buyer can confirm.`
      : `The delivery date was ${when} and nothing has been shipped. If it stays that way the buyer is refunded in full.`,
  };
}
