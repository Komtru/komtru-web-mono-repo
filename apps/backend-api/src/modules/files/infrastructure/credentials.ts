// Cannibalized from kumtru/backend-apis/src/modules/files/infrastructure/cloudinary.ts (T-001), the
// credential-lookup half. Adapted: it takes the FilesConfig rather than reading a process-wide config
// singleton, so nothing here imports the process and every call site states which environment it means.
import type { CloudinaryCredentials, FilesConfig } from '../../../config/env.js';
import { StorageAccountUnconfiguredError } from '../domain/errors.js';

export type { CloudinaryCredentials };

/**
 * Resolves an account's credentials by its `credential_env_prefix` (D7).
 *
 * Throws rather than returning undefined: a `file_records` row pointing at an account with no
 * credentials cannot be served at all. The error carries the three variable names for the log; the
 * route boundary turns it into a generic 503 (see domain/errors.ts).
 */
export const credentialsFor = (files: FilesConfig, credentialEnvPrefix: string): CloudinaryCredentials => {
  const found = files.accounts[credentialEnvPrefix];

  if (!found) throw new StorageAccountUnconfiguredError(credentialEnvPrefix);

  return found;
};

/**
 * Whether an account can be used here at all, without throwing.
 *
 * Rotation and the usage sweep both ask this first: `storage_accounts` rows travel between
 * environments through the seed and the register endpoint, so staging can easily hold a row only
 * production has secrets for. Rotating onto one would mint an upload ticket that cannot be signed.
 */
export const isAccountConfigured = (files: FilesConfig, credentialEnvPrefix: string): boolean =>
  files.accounts[credentialEnvPrefix] !== undefined;
