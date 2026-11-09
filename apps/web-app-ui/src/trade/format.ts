// What a proposal screen says and how it says it. Pure functions, so the wording rules are tested
// without a DOM. Money arrives as a digit string of kobo and is only ever formatted here, never summed.
import { ProblemError, type TradeView } from '@komtru/api-client';
import { formatNaira } from '@komtru/shared-types';

export const naira = (minor: string): string => formatNaira(BigInt(minor));

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

export const isProblem = (error: unknown, code: string): error is ProblemError =>
  error instanceof ProblemError && error.code === code;

/**
 * The sentence for a failed call, from the problem's code and never from its title: titles are copy
 * the backend may reword. A problem the screen has nothing specific to say about gets `fallback`,
 * plus the backend's own detail when it sent one, because "Attach 2 more photos" is better than
 * "Something went wrong".
 */
export function problemMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ProblemError)) return fallback;
  switch (error.code) {
    case 'MERCHANT_CANNOT_BUY':
      return "A certified merchant can't be the buyer on a trade. They sell on Komtru; they don't buy.";
    case 'ADDRESS_REQUIRED':
      return 'Choose or add a saved address first.';
    case 'RATE_LIMITED':
      return 'Too many tries. Wait a minute and try again.';
    case 'INVALID_TRANSITION':
      return 'This trade has moved on since you opened it. Reload to see where it stands.';
    case 'NOT_FOUND':
      return "We can't find that trade. It may have been withdrawn.";
    case 'UNAUTHENTICATED':
    case 'SESSION_REVOKED':
    case 'TOKEN_EXPIRED':
      return 'Sign in again to carry on.';
    default:
      return error.problem.detail ?? fallback;
  }
}

/** The name a trade's item goes by: brand and model when the category asks for them, else the category. */
export function itemTitle(spec: unknown, fallback = 'Item'): string {
  const record = asRecord(spec);
  const named = ['brand', 'model', 'name', 'item']
    .map((key) => text(record[key]))
    .filter((value): value is string => value !== undefined);
  return named.length > 0 ? named.join(' ') : fallback;
}

/** The second line under the title: whatever else the person described, in the order they typed it. */
export function itemSub(spec: unknown): string | undefined {
  const record = asRecord(spec);
  const skip = new Set(['brand', 'model', 'name', 'item']);
  const rest = Object.entries(record)
    .filter(([key]) => !skip.has(key))
    .map(([, value]) => text(value))
    .filter((value): value is string => value !== undefined);
  return rest.length > 0 ? rest.join(' · ') : undefined;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : undefined;

/** An address snapshot as one line: the street, then the landmark when there is one. */
export function addressLine(snapshot: unknown): string {
  const record = asRecord(snapshot);
  const parts = [text(record.street), text(record.landmark)].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length > 0 ? parts.join(', ') : 'No address on this version';
}

export const hoursLabel = (hours: number): string =>
  hours % 24 === 0 ? `${String(hours / 24)} day${hours === 24 ? '' : 's'}` : `${String(hours)} hours`;

export type RowTone = 'protected' | 'awaiting' | 'risk' | 'resolved' | 'verified' | 'verifying';

export interface TradeState {
  tone: RowTone;
  label: string;
  /** The line under the row on the list, after the trade code. */
  sub: string;
  /** Whether this row is waiting on the person looking at it. */
  needsYou: boolean;
  /** Finished without being funded: nothing more to do. */
  closed: boolean;
}

/**
 * Where a proposal stands, in the words the person would use. The status names are the backend's;
 * one this version does not know falls back to a neutral line rather than hiding the trade.
 */
export function describeTrade(
  trade: Pick<TradeView, 'status' | 'awaiting' | 'tradeCode' | 'yourRole' | 'initiatorRole'>,
): TradeState {
  const code = `Proposal ${trade.tradeCode}`;
  const mine = trade.yourRole === trade.initiatorRole;
  switch (trade.status) {
    case 'UNDER_PROPOSAL_REVIEW':
      return {
        tone: 'verifying',
        label: 'Verification needed',
        sub: `${code} · held for review, not yet sent`,
        needsYou: mine,
        closed: false,
      };
    case 'PENDING_COUNTERPARTY':
      return {
        tone: 'awaiting',
        label: 'Invited',
        sub: `${code} · waiting for them to join Komtru`,
        needsYou: false,
        closed: false,
      };
    case 'AWAITING_ACCEPTANCE':
      return trade.awaiting === 'YOU'
        ? {
            tone: 'awaiting',
            label: 'Your answer',
            sub: `${code} · waiting for you`,
            needsYou: true,
            closed: false,
          }
        : {
            tone: 'awaiting',
            label: 'Sent',
            sub: `${code} · waiting for their answer`,
            needsYou: false,
            closed: false,
          };
    case 'PENDING_PAYMENT':
      return {
        tone: 'protected',
        label: 'Terms agreed',
        sub: `${code} · agreed, waiting for payment`,
        needsYou: false,
        closed: false,
      };
    case 'DECLINED':
      return { tone: 'risk', label: 'Declined', sub: code, needsYou: false, closed: true };
    case 'REJECTED':
      return {
        tone: 'risk',
        label: 'Not sent',
        sub: `${code} · did not pass review`,
        needsYou: false,
        closed: true,
      };
    case 'CANCELLED':
      return { tone: 'risk', label: 'Cancelled', sub: code, needsYou: false, closed: true };
    case 'EXPIRED':
      return { tone: 'risk', label: 'Expired', sub: code, needsYou: false, closed: true };
    case 'DRAFT':
      return {
        tone: 'awaiting',
        label: 'Draft',
        sub: `${code} · not sent yet`,
        needsYou: mine,
        closed: false,
      };
    default:
      return {
        tone: 'protected',
        label: 'In progress',
        sub: `Trade ${trade.tradeCode}`,
        needsYou: false,
        closed: false,
      };
  }
}
