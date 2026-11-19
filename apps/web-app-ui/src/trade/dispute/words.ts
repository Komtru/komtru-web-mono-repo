// What the dispute screens (F-032, T-120 and T-196) may say, as pure functions. Nothing here
// computes a money amount: a dispute's figures are the platform's own, and the fee rule behind a
// partial outcome is the ledger's, never re-derived on a screen.
//
// THE REASON VOCABULARY. The reference lists four different "What went wrong?" sets — Customer-7,
// DI-01, CWT-S14 and CWT-S17 each have their own. They cannot all be the enum, and the platform
// takes one category. DI-01's is canonical here, because DI-01 is the reference's own *structured
// intake* and every other intake screen funnels into it (CWT-S14 and CWT-S17 both say "Continue
// to issue review" → DI-01). The other three sets are recorded as deviations in the ui-review
// files rather than silently dropped.
import type { Dispute, DisputeDecision, DisputeStatus } from '@komtru/api-client';
import { formatNaira } from '@komtru/shared-types';
import type { TradeRole } from '../workspace-state';

/**
 * DI-01's four options, each with the platform category it files under.
 *
 * Two of them file under the same category, and that is not a bug to tidy away: M3's categories
 * have no "damaged" — the nearest true statement about a damaged item is that it is not as
 * described. The distinction the buyer drew survives in `id`, which the screen keeps for its own
 * selection, and in the description they write, which is on the case. Inventing a category the
 * platform does not have would be worse: it would be a value no reviewer's queue could filter on.
 * Flagged for the owner.
 */
export interface IssueReason {
  /** The screen's own identity for the option, since two share a category. */
  id: string;
  label: string;
  /** What the platform stores. */
  category: 'ITEM_NOT_AS_DESCRIBED' | 'ITEM_NOT_RECEIVED' | 'PAYMENT_ISSUE' | 'OTHER';
}

/** DI-01's order, which is the order every intake screen funnels into. */
export const ISSUE_REASONS: readonly IssueReason[] = [
  { id: 'DAMAGED', label: 'Arrived damaged', category: 'ITEM_NOT_AS_DESCRIBED' },
  { id: 'NOT_AS_DESCRIBED', label: 'Not as described', category: 'ITEM_NOT_AS_DESCRIBED' },
  { id: 'MISSING', label: 'Item or parts missing', category: 'ITEM_NOT_RECEIVED' },
  { id: 'OTHER', label: 'Other concern', category: 'OTHER' },
];

const CATEGORY_WORDS: Record<string, string> = {
  ITEM_NOT_AS_DESCRIBED: 'Not as described',
  ITEM_NOT_RECEIVED: 'Item never arrived',
  PAYMENT_ISSUE: 'Payment issue',
  SELLER_UNRESPONSIVE: 'Seller unresponsive',
  BUYER_UNRESPONSIVE: 'Buyer unresponsive',
  OTHER: 'Other concern',
};

/** A category as a screen shows it; an unknown one is shown as the platform wrote it, not hidden. */
export const reasonLabel = (category: string): string => CATEGORY_WORDS[category] ?? category;

/** SP-M23's three, which are about why you are closing it, not about what went wrong. */
export const WITHDRAW_REASONS: readonly { code: string; label: string }[] = [
  { code: 'SORTED_TOGETHER', label: 'We sorted it out together' },
  { code: 'MISTAKE', label: 'I made a mistake' },
  { code: 'OTHER', label: 'Something else' },
];

/** What the case is waiting on, in the words Customer-8 and CWT-S15 use. */
export function stageLabel(status: DisputeStatus): string {
  switch (status) {
    case 'MEDIATION':
      return 'Awaiting a response';
    case 'OPEN_EVIDENCE_COLLECTION':
      return 'Evidence requested';
    case 'UNDER_REVIEW':
      return 'TrustOps review';
    case 'DECIDED':
      return 'Decided';
    case 'APPEALED':
    case 'APPEAL_UNDER_REVIEW':
      return 'Appeal under review';
    case 'CLOSED':
      return 'Closed';
  }
}

/** The chip beside the amount. `risk` until it is settled, `resolved` after. */
export function statusChip(status: DisputeStatus): { tone: 'risk' | 'resolved'; label: string } {
  if (status === 'CLOSED') return { tone: 'resolved', label: 'Resolved' };
  if (status === 'DECIDED') return { tone: 'resolved', label: 'Decided' };
  return { tone: 'risk', label: 'Under Review' };
}

/** The sub-line under the amount: the reference's reassurance that nothing has moved. */
export function fundsLine(status: DisputeStatus, role: TradeRole): string {
  if (status === 'CLOSED' || status === 'DECIDED') {
    return role === 'BUYER' ? 'The outcome is below' : 'The outcome is below';
  }
  return role === 'BUYER'
    ? 'Still protected — no funds have moved'
    : 'Funds protected — no refund issued yet';
}

/** Y1's and Seller-7's countdown strips, from the window the platform says is running. */
export function countdownLine(dispute: Pick<Dispute, 'window' | 'status'>): string | null {
  const { kind, remaining } = dispute.window;
  if (remaining === null || kind === 'NONE') return null;
  const left = remaining.expired
    ? 'shortly'
    : remaining.hours > 0
      ? `${String(remaining.hours)}h`
      : `${String(remaining.minutes)}m`;
  switch (kind) {
    case 'MEDIATION':
      return `Auto-escalates to TrustOps in ${left} if not mutually resolved`;
    case 'EVIDENCE':
      return `Evidence closes in ${left} — the same window for both sides`;
    case 'APPEAL':
      return `One appeal is available for ${left}`;
  }
}

/**
 * H1 and H2: the same case, said two ways. This asymmetry is the reference's whole point and the
 * Trust Model's — the seller's screen is corrective, not a verdict on their character — so it is
 * one function with the two framings beside each other rather than two components that drift.
 */
export interface OutcomeCopy {
  tone: 'success' | 'info';
  title: string;
  body: string;
  /** H1 shows what TrustOps decided; H2 deliberately does not. */
  showRationale: boolean;
  /** H2's closing line about cooperating. */
  closing: string | null;
}

export function outcomeCopy(
  role: TradeRole,
  decision: Pick<DisputeDecision, 'outcome' | 'amountToBuyerMinor' | 'amountToSellerMinor'>,
  counterpartyName: string,
): OutcomeCopy {
  const toBuyer = formatNaira(BigInt(decision.amountToBuyerMinor), { showKobo: false });
  const full = decision.outcome === 'REFUND_BUYER_FULL';
  const released = decision.outcome === 'RELEASE_SELLER_FULL';

  if (role === 'BUYER') {
    return {
      tone: 'success',
      title: released
        ? 'The payment was released'
        : full
          ? 'Refund issued in full'
          : 'A partial refund was issued',
      body: released
        ? `The evidence supported the seller's account, so ${counterpartyName} has been paid. The same policy is applied to every case.`
        : `${toBuyer} has been returned to your original payment method. ${counterpartyName} was notified with the same reason shown below.`,
      showRationale: true,
      closing: null,
    };
  }

  // H2. Recoloured to info rather than success on purpose: a refund against the seller is not a
  // failure state, and painting it red would make it one.
  return {
    tone: 'info',
    title: released ? 'The payment was released to you' : `Refund issued to ${counterpartyName}`,
    body: released
      ? `The evidence supported your account. The payment is on its way to your payout account.`
      : `This wasn't ruled against you personally — the issue was confirmed against the original listing. Your quick, cooperative response is recorded, not penalized.`,
    showRationale: false,
    closing: released
      ? null
      : 'Cooperating fully with a dispute keeps this from reading the same as a seller who refused to engage — that distinction is deliberate.',
  };
}

/** H2's Trust Profile row. The event type is the point: corrective, never negative. */
export const TRUST_EVENT = 'Corrective';
export const TRUST_EVENT_LABEL = 'Event type — not Negative';

/** AC6's banner, which is also the rule the platform enforces. */
export const APPEAL_NOTE =
  "One appeal per case, reviewed by a specialist who wasn't part of the original decision. This doesn't reopen the evidence already submitted.";

/** DI-01's banner: the honest limit on what filing a report does. */
export const INTAKE_NOTE =
  'Komtru reviews the issue against the agreed terms and the evidence submitted. A refund or return is not guaranteed by submitting a report.';

/** Customer-7's and CWT-S14's lead line. The amount is the trade's own, never recomputed. */
export const protectedLead = (itemAmountMinor: string): string =>
  `Your ${formatNaira(BigInt(itemAmountMinor), { showKobo: false })} stays protected while this is reviewed — nothing releases until it is resolved.`;

/** Whether this person can still withdraw the case (SP-M23 is offered only when they can). */
export const canWithdraw = (dispute: Pick<Dispute, 'status' | 'openedByUserId'>, userId: string): boolean =>
  dispute.status === 'MEDIATION' && dispute.openedByUserId === userId;

/** Whether the appeal button belongs on the screen at all. */
export const canAppeal = (dispute: Pick<Dispute, 'status' | 'appealFiledAt'>): boolean =>
  dispute.status === 'DECIDED' && dispute.appealFiledAt === null;
