import { ApiError } from '../../../platform/errors.js';
import type { CaseState } from './types.js';

export const caseNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such case');

export const evidenceRequestNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such evidence request');

export const caseFinished = (state: CaseState) =>
  new ApiError(409, 'INVALID_TRANSITION', 'This case is already decided or closed', undefined, undefined, {
    state,
  });

export const caseAlreadyOwned = (ownerUserId: string) =>
  new ApiError(
    409,
    'CONFLICT',
    'Someone else already has this case',
    'Ask for it to be reassigned',
    undefined,
    {
      ownerUserId,
    },
  );

export const notCaseOwner = () =>
  new ApiError(
    409,
    'CONFLICT',
    'Only the case owner can decide it',
    'Take the case first, or ask for it to be reassigned to you',
  );

export const assigneeNotEligible = () =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'That person cannot work cases',
    'Choose a staff member whose role carries cases.manage',
    [{ path: 'toUserId', message: 'Not a case handler' }],
  );

export const evidenceRequestResolved = () =>
  new ApiError(409, 'INVALID_TRANSITION', 'This evidence request is already resolved');
