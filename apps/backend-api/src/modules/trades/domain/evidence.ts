// F-028 (CWT-S13): the rules for evidence the parties add to a live trade. Pure; the service reads and writes.
import { ApiError } from '../../../platform/errors.js';
import type { CursorKey } from '../../../platform/http/paginate.js';
import { TRADE_EVIDENCE_EVENTS } from '../infrastructure/postgres/schema/enums.js';

export { TRADE_EVIDENCE_EVENTS };
export type TradeEvidenceEvent = (typeof TRADE_EVIDENCE_EVENTS)[number];
export type PartyRole = 'BUYER' | 'SELLER';

/** Evidence supports a trade that is still moving; a closed trade's record does not change. */
export const EVIDENCE_OPEN_STATUSES: readonly string[] = [
  'SHIPPED',
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'DISPUTED',
];

/**
 * Who may add what. Dispatch is the seller's account of sending it, inspection the buyer's of receiving it;
 * delivery and issue are either side's. The screen offers only these, and the service enforces them.
 */
export const EVENT_ROLES: Record<TradeEvidenceEvent, readonly PartyRole[]> = {
  DISPATCH: ['SELLER'],
  DELIVERY: ['BUYER', 'SELLER'],
  INSPECTION: ['BUYER'],
  ISSUE: ['BUYER', 'SELLER'],
};

export const MAX_FILES_PER_ATTACH = 10;
export const MAX_FILES_PER_EVENT = 20;

export const mayAttach = (role: PartyRole, event: TradeEvidenceEvent): boolean =>
  EVENT_ROLES[event].includes(role);

export const evidenceClosedError = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'Evidence can’t be added now',
    'Evidence can be added while the trade is shipped, being delivered, in inspection or under review.',
    undefined,
    { reason: 'EVIDENCE_CLOSED' },
  );

export const wrongRoleError = (event: TradeEvidenceEvent): ApiError =>
  new ApiError(
    403,
    'FORBIDDEN',
    event === 'DISPATCH'
      ? 'Only the seller can add dispatch evidence'
      : 'Only the buyer can add inspection evidence',
  );

export const tooManyEvidenceError = (event: TradeEvidenceEvent): ApiError =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    `A trade can carry at most ${String(MAX_FILES_PER_EVENT)} ${event.toLowerCase()} files`,
    undefined,
    [{ path: 'fileIds', message: 'Too many files for this category' }],
  );

export const fileProcessingError = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'A file is still being processed',
    'Give it a moment and add it again.',
    undefined,
    { reason: 'FILE_PROCESSING' },
  );

export const unusableFilesError = (ids: readonly string[]): ApiError =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'Some files cannot be used as evidence',
    'Evidence must be your own finished uploads, not used anywhere else.',
    ids.map((id) => ({ path: 'fileIds', message: `${id} is not a usable upload` })),
  );

const MICRO_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const evidenceCursor = (
  row: { cursorTs: string; id: string },
  tradeId: string,
  event: TradeEvidenceEvent | undefined,
): CursorKey => ({ t: row.cursorTs, id: row.id, f: tradeId, e: event ?? 'ALL' });

const wrongCursor = (): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'Invalid cursor', 'Use the nextCursor from the previous page');

/** Strict on every field, and bound to the trade and filter it was made for: anything else is a 422, never page 1. */
export function readEvidenceCursor(
  cursor: CursorKey | undefined,
  tradeId: string,
  event: TradeEvidenceEvent | undefined,
): { ts: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const { t, id, f, e } = cursor;
  const valid =
    Object.keys(cursor).sort().join(',') === 'e,f,id,t' &&
    typeof t === 'string' &&
    MICRO_ISO.test(t) &&
    !Number.isNaN(Date.parse(t)) &&
    typeof id === 'string' &&
    UUID.test(id) &&
    typeof f === 'string' &&
    f.toLowerCase() === tradeId.toLowerCase() &&
    e === (event ?? 'ALL');
  if (!valid) throw wrongCursor();
  return { ts: t, id };
}
