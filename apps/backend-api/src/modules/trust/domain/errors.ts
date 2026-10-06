// This module's own failures, so a caller branches on a type rather than on a message.
import { ApiError } from '../../../platform/errors.js';

/**
 * A provider was selected that cannot run — missing credentials, or no live integration behind it.
 *
 * Thrown at module start where it names the variables an operator must set, and from the Dojah
 * adapter's methods where it names the thing that does not exist yet. It is deliberately NOT an
 * ApiError: a caller never sees it, because a request handler never reaches a provider.
 */
export class KycProviderNotConfiguredError extends Error {
  constructor(
    readonly provider: string,
    readonly missing: readonly string[],
  ) {
    super(`${provider}: not configured — ${missing.join(', ')}`);
    this.name = 'KycProviderNotConfiguredError';
  }
}

/** M6 §2: identity verification needs a user who has already proved an email and a phone. */
export const contactVerificationRequired = (): ApiError =>
  new ApiError(
    409,
    'CONTACT_VERIFICATION_REQUIRED',
    'Verify your email and phone first',
    'Identity verification needs a confirmed email address and phone number on your account.',
  );
