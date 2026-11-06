import { ApiError } from '../../../platform/errors.js';

export const stateNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such state');

export const cityNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such city');

export const cityRequestNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such city request');

/**
 * A name already in the catalog. The id travels as an extension member so a form can select the
 * existing city instead of offering "My city isn't listed", and staff can reactivate it.
 */
export const cityExists = (cityId: string, name: string, active: boolean) =>
  new ApiError(
    409,
    'CONFLICT',
    active ? 'That city is already listed' : 'That city is already in the catalog but deactivated',
    active
      ? `${name} is already in this state's list`
      : `${name} exists and is deactivated; reactivate it instead of adding it again`,
    undefined,
    { cityId, active },
  );

export const requestAlreadyDecided = () =>
  new ApiError(
    409,
    'INVALID_TRANSITION',
    'This request has already been decided',
    'Another reviewer got there first',
  );

export const aliasClash = (alias: string, otherName: string) =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'An alias collides with another city',
    `"${alias}" is the name of ${otherName} in this state`,
    [{ path: 'aliases', message: `"${alias}" is the name of ${otherName}` }],
  );

export const mergeTargetInvalid = (message: string) =>
  new ApiError(422, 'VALIDATION_FAILED', 'That city cannot take this request', message, [
    { path: 'cityId', message },
  ]);
