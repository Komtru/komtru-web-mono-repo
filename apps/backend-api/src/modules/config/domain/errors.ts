import { ApiError } from '../../../platform/errors.js';

/** A setting that code reads but the database does not hold: a deploy that skipped the seed. */
export class SettingMissingError extends Error {
  constructor(namespace: string, key: string) {
    super(`config: setting ${namespace}.${key} is not in platform_settings; run pnpm db:seed`);
    this.name = 'SettingMissingError';
  }
}

/** A setting read as one type and stored as another: a code bug, never a runtime condition. */
export class SettingTypeError extends Error {
  constructor(namespace: string, key: string, wanted: string, stored: string) {
    super(`config: ${namespace}.${key} is ${stored}, read as ${wanted}`);
    this.name = 'SettingTypeError';
  }
}

export const settingNotFound = (namespace: string, key: string) =>
  new ApiError(404, 'NOT_FOUND', 'No such setting', `${namespace}.${key} is not a known setting`);

export const invalidValue = (message: string) =>
  new ApiError(422, 'VALIDATION_FAILED', 'The value is not valid for this setting', message, [
    { path: 'value', message },
  ]);

/** Design 6.5: a fee is changed in config/fees.yaml, through a PR, and nowhere else. */
export const feeRefused = (what: string) =>
  new ApiError(
    400,
    'VALIDATION_FAILED',
    'Fees are not configuration',
    `${what} names a fee, commission or cut. Those live only in config/fees.yaml and change through a reviewed deploy.`,
  );
