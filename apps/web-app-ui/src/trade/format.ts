// What a proposal screen says and how it says it. Pure functions, so the wording rules are tested
// without a DOM. Money arrives as a digit string of kobo and is only ever formatted here, never summed.
import { ProblemError } from '@komtru/api-client';
import { REQUEST_KEYS, SELLER_TO_CONFIRM } from './create/request';
import { isWorkspaceStatus, workspaceStanding } from './workspace-state';
import {
  formatNaira,
  type CounterpartyDisplay,
  type TradeAttention,
  type TradeListItem,
} from '@komtru/shared-types';

export const naira = (minor: string): string => formatNaira(BigInt(minor));

/** A list row's amount, as Q1 writes it: whole naira unless there are kobo to show. */
export const nairaShort = (minor: string): string => {
  const kobo = BigInt(minor);
  return formatNaira(kobo, { showKobo: kobo % 100n !== 0n });
};

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

/** A person's name as a row or strip shows it: display name, else handle, else nothing guessed. */
export const partyName = (party: CounterpartyDisplay): string =>
  party.displayName ?? (party.username === null ? 'A Komtru member' : `@${party.username}`);

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
    case 'CONFLICT':
      // The platform's answer to a stale revision or a stale terms version.
      return 'The terms changed while you were looking. We loaded the latest. Review them and try again.';
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

/** The platform's own sentence when it sent one (a refused receipt, a passed deadline), else ours. */
export const platformWords = (error: unknown, fallback: string): string =>
  error instanceof ProblemError && error.problem.detail !== undefined
    ? error.problem.detail
    : problemMessage(error, fallback);

/** The name a trade's item goes by: brand and model when the category asks for them, else the buyer's own words. */
export function itemTitle(spec: unknown, fallback = 'Item'): string {
  const record = asRecord(spec);
  const named = ['brand', 'model', 'name', 'item']
    .map((key) => text(record[key]))
    .filter((value): value is string => value !== undefined);
  if (named.length > 0) return named.join(' ');
  return text(record.requestedItem) ?? fallback;
}

/** The second line under the title: whatever else the person described, in the order they typed it. */
export function itemSub(spec: unknown): string | undefined {
  const record = asRecord(spec);
  const skip = new Set(['brand', 'model', 'name', 'item', ...REQUEST_KEYS]);
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

/** A value the person said. A field still waiting on the seller (`SELLER_TO_CONFIRM`) is not something anyone said. */
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value !== SELLER_TO_CONFIRM
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

/** Hours, as the reference writes a window ("48 hours"): a standard is stated in the unit it is set in. */
export const hoursLabel = (hours: number): string => `${String(hours)} hour${hours === 1 ? '' : 's'}`;

export type RowTone = 'protected' | 'awaiting' | 'risk' | 'resolved' | 'verified' | 'verifying';

export interface TradeState {
  tone: RowTone;
  label: string;
  /** The line under the row on the list, after the trade code. */
  sub: string;
  /** Finished without being funded: nothing more to do. */
  closed: boolean;
}

/** Why a trade is waiting on you, in a chip's words. The server decides *whether*; this only words it. */
const ATTENTION_LABEL: Record<TradeAttention, string> = {
  RESPOND_TO_PROPOSAL: 'Your answer',
  PAY: 'Payment due',
  SHIP: 'Ship it',
  CONFIRM_DELIVERY: 'Confirm delivery',
  INSPECT: 'Inspect it',
  RESPOND_TO_EXTENSION: 'Extension request',
};

/**
 * Where a trade stands, in the words the person would use. The status names and `attention` are the
 * backend's: whether the trade is waiting on you is never decided here, because it depends on state a
 * row cannot see. A status this version does not know falls back to a neutral line.
 */
export function describeTrade(trade: Pick<TradeListItem, 'status' | 'attention' | 'tradeCode'>): TradeState {
  const code = `Proposal ${trade.tradeCode}`;
  if (trade.attention !== null) {
    return {
      tone: 'awaiting',
      label: ATTENTION_LABEL[trade.attention],
      sub: trade.status === 'AWAITING_ACCEPTANCE' ? `${code} · waiting for you` : `Trade ${trade.tradeCode}`,
      closed: false,
    };
  }
  switch (trade.status) {
    case 'UNDER_PROPOSAL_REVIEW':
      return {
        tone: 'verifying',
        label: 'Verification Needed',
        sub: `${code} · held for review, not yet sent`,
        closed: false,
      };
    case 'PENDING_COUNTERPARTY':
      return {
        tone: 'awaiting',
        label: 'Invited',
        sub: `${code} · waiting for them to join Komtru`,
        closed: false,
      };
    case 'AWAITING_ACCEPTANCE':
      return { tone: 'awaiting', label: 'Sent', sub: `${code} · waiting for their answer`, closed: false };
    case 'PENDING_PAYMENT':
      return {
        tone: 'protected',
        label: 'Terms agreed',
        sub: `${code} · agreed, waiting for payment`,
        closed: false,
      };
    case 'DECLINED':
      return { tone: 'risk', label: 'Declined', sub: code, closed: true };
    case 'REJECTED':
      return { tone: 'risk', label: 'Not sent', sub: `${code} · did not pass review`, closed: true };
    case 'CANCELLED':
      return { tone: 'risk', label: 'Cancelled', sub: code, closed: true };
    case 'EXPIRED':
      return { tone: 'risk', label: 'Expired', sub: code, closed: true };
    case 'DRAFT':
      return { tone: 'awaiting', label: 'Draft', sub: `${code} · not sent yet`, closed: false };
    default: {
      // From the agreement onward the workspace words it: one place says what each status is called.
      if (isWorkspaceStatus(trade.status)) {
        const standing = workspaceStanding(trade.status);
        return {
          tone: standing.chip.tone,
          label: standing.chip.label,
          sub: `Trade ${trade.tradeCode}`,
          closed: standing.closed,
        };
      }
      return { tone: 'protected', label: 'In progress', sub: `Trade ${trade.tradeCode}`, closed: false };
    }
  }
}

/**
 * What a seller must attach, by the platform's own rule (`checkProofMedia`): a standard's `minPhotos`
 * raises the bar and cannot lower it below one piece of media, so a standard that asks for no photos
 * still asks for one unless it asks for a video instead. Photos and videos are counted apart.
 */
export function proofNeeds(proofMedia: { minPhotos: number; requireVideo: boolean }): {
  photos: number;
  video: boolean;
} {
  return {
    photos: Math.max(proofMedia.minPhotos, proofMedia.requireVideo ? 0 : 1),
    video: proofMedia.requireVideo,
  };
}

/**
 * A moment as the reference writes it ("30 Sep · 13:24"), in Lagos time: every trade here is Nigerian and a
 * deadline that reads differently on two phones is a dispute waiting to happen. A value that is not a date
 * is shown as nothing rather than "Invalid Date".
 */
export function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} · ${part('hour')}:${part('minute')}`;
}
