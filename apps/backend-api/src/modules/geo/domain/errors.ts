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

export const MAX_PENDING_REQUESTS_PER_USER = 20;

export const requestLimitReached = () =>
  new ApiError(
    409,
    'CITY_REQUEST_LIMIT_REACHED',
    'You have too many city requests waiting',
    `Wait for a decision on your ${MAX_PENDING_REQUESTS_PER_USER} open requests before asking for another`,
  );

/** A new or renamed city whose name is already a search alias of a different city in the state. */
export const nameIsAlias = (name: string, otherName: string) =>
  new ApiError(
    409,
    'CONFLICT',
    'That name is already a search alias of another city',
    `${name} is an alias of ${otherName} in this state; remove the alias first, or merge instead`,
  );

export const aliasClash = (alias: string, otherName: string) =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'An alias collides with another city',
    `"${alias}" is the name of ${otherName} in this state`,
    [{ path: 'aliases', message: `"${alias}" is the name of ${otherName}` }],
    { alias, otherName },
  );

export const mergeTargetInvalid = (message: string) =>
  new ApiError(422, 'VALIDATION_FAILED', 'That city cannot take this request', message, [
    { path: 'cityId', message },
  ]);

/** A merge's automatic alias hit another city; staff can still merge without it. */
export const mergeAliasClash = (alias: string, otherName: string) =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'The typed name collides with another city',
    `"${alias}" is the name of ${otherName} in this state. Retry the merge with addAlias:false to merge without keeping it as an alias.`,
    [{ path: 'addAlias', message: 'Retry with addAlias:false' }],
  );
