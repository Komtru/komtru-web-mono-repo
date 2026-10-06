// The module's own failures, translated to HTTP at the route boundary (the shape notify uses for
// SecurityPreferenceError). Keeping them out of ApiError is deliberate where the operator's detail
// and the caller's detail are different things.

/**
 * A storage account exists as a row but has no credentials in this environment.
 *
 * Carries the variable names for the log and for an operator-facing surface. They are NOT put in an
 * `ApiError.detail`, which is copied verbatim into the problem+json body: a consumer who just tried
 * to upload a photo has no use for `CLOUDINARY_TRADE_2_API_SECRET`, and an attacker has some.
 */
export class StorageAccountUnconfiguredError extends Error {
  readonly missingVariables: readonly string[];

  constructor(readonly credentialEnvPrefix: string) {
    super(`storage account ${credentialEnvPrefix} has no credentials in this environment`);
    this.name = 'StorageAccountUnconfiguredError';
    this.missingVariables = [
      `${credentialEnvPrefix}_CLOUD_NAME`,
      `${credentialEnvPrefix}_API_KEY`,
      `${credentialEnvPrefix}_API_SECRET`,
    ];
  }
}

/** Every account in a pool is unusable, so the upload fails closed (D6) rather than falling back. */
export class PoolExhaustedError extends Error {
  constructor(readonly pool: string) {
    super(`no usable storage account in the ${pool} pool`);
    this.name = 'PoolExhaustedError';
  }
}
