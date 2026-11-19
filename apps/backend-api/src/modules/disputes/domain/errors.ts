// This module's refusals, as typed ApiErrors. Everything leaves as RFC 9457 problem+json.
//
// Two rules run through the wording. A refusal aimed at a party says what to do next, because the
// party is a person mid-flow. A refusal that would reveal whether a dispute exists says as little
// as possible: `disputeNotFound` and `notADisputeParty` deliberately read the same from outside, so
// a dispute id is not an oracle for "these two are in a fight".
import { ApiError } from '../../../platform/errors.js';
import type { AppealRefusal } from './appeal.js';
import type { ReviewerRefusal } from './assignment.js';
import type { DisputeAction, DisputeStatus } from './types.js';

export const disputeNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such dispute');

/** Same shape and status as "no such dispute": a non-party learns nothing by trying. */
export const notADisputeParty = () => new ApiError(404, 'NOT_FOUND', 'No such dispute');

export const invalidTransition = (action: DisputeAction, from: DisputeStatus) =>
  new ApiError(
    409,
    'INVALID_TRANSITION',
    'This case has already moved on',
    'Reload the case to see where it is now.',
    undefined,
    { action, from },
  );

export const disputeAlreadyOpen = (tradeId: string) =>
  new ApiError(
    409,
    'CONFLICT',
    'This trade already has an open dispute',
    'Open the existing case instead of starting a second one.',
    undefined,
    { tradeId },
  );

export const tradeNotDisputable = (status: string) =>
  new ApiError(
    409,
    'INVALID_TRANSITION',
    'This trade can’t be disputed right now',
    'A dispute can be opened once the item has shipped and before the trade is settled.',
    undefined,
    { status },
  );

export const evidenceWindowClosed = () =>
  new ApiError(
    409,
    'CONFLICT',
    'The evidence window has closed',
    'A reviewer can reopen it if there is something new they need to see.',
    undefined,
    { reason: 'EVIDENCE_WINDOW_CLOSED' },
  );

export const mediationNotOpen = () =>
  new ApiError(
    409,
    'CONFLICT',
    'This case is past mediation',
    'It is with a reviewer now; you can still add evidence while the window is open.',
  );

const APPEAL_REFUSAL: Readonly<Record<AppealRefusal, { title: string; detail: string }>> = Object.freeze({
  NOT_A_PARTY: { title: 'No such dispute', detail: '' },
  NOT_DECIDED: {
    title: 'There is no decision to appeal yet',
    detail: 'An appeal opens once the case has been decided.',
  },
  ALREADY_APPEALED: {
    title: 'This case has already been appealed',
    detail: 'One appeal per case — the lead reviewing it will have the final say.',
  },
  WINDOW_CLOSED: {
    title: 'The appeal window has closed',
    detail: 'A decision becomes final once its appeal window passes.',
  },
});

export const appealRefused = (reason: AppealRefusal) => {
  if (reason === 'NOT_A_PARTY') return notADisputeParty();
  const { title, detail } = APPEAL_REFUSAL[reason];
  return new ApiError(409, 'CONFLICT', title, detail, undefined, { reason });
};

const REVIEWER_REFUSAL: Readonly<Record<ReviewerRefusal, string>> = Object.freeze({
  IS_A_PARTY: 'That reviewer is a party to this dispute',
  SHARES_DEVICE: 'That reviewer shares a device with one of the parties',
  SHARES_PAYOUT_INSTRUMENT: 'That reviewer shares a payout instrument with one of the parties',
  ORIGINAL_REVIEWER: 'An appeal cannot go back to the reviewer who decided it',
});

/** 422 rather than 409: the assignment is well-formed, the person named is the problem. */
export const reviewerRefused = (reason: ReviewerRefusal) =>
  new ApiError(422, 'VALIDATION_FAILED', REVIEWER_REFUSAL[reason], 'Choose a different reviewer.', [
    { path: 'reviewerId', message: REVIEWER_REFUSAL[reason] },
  ]);

/**
 * The arithmetic refusal. 422 and not 409: a reviewer who typed amounts that do not add up is
 * being told their input is wrong, not that the world moved underneath them.
 */
export const decisionAmountsMismatch = (detail: string) =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'Those amounts do not describe the money held for this trade',
    detail,
    [{ path: 'amountToBuyerMinor', message: detail }],
  );

export const mediationProposalNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such mediation proposal');

export const cannotRespondToOwnProposal = () =>
  new ApiError(409, 'CONFLICT', 'You proposed this', 'Wait for the other party to answer it.');

export const proposalAlreadyAnswered = () =>
  new ApiError(409, 'CONFLICT', 'This proposal has already been answered');

export const onlyOpenerMayWithdraw = () =>
  new ApiError(
    403,
    'FORBIDDEN',
    'Only the person who opened this dispute can withdraw it',
    'The other party can agree an outcome with you instead.',
  );

/** A well-formed cursor that is not one of this list's: the client's mistake, never page one again. */
export const wrongCursor = () =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'Invalid cursor',
    'Use the nextCursor from the previous page of this list',
  );
