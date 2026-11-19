// The Youverify adapter — the first one with a live account behind it.
//
// Unlike `dojah.client.ts`, which refuses everything because no account exists, this file refuses
// only what the account is not entitled to. The distinction is the point: a refusal here names a
// permission somebody can go and buy, not an integration nobody has written.
//
// What the sandbox answered on 2026-11-19, with fixtures in `test/fixtures/youverify/`:
//
//   POST /v2/api/identity/ng/nin    200, verdict inline      -> implemented
//   POST /v2/api/identity/ng/bvn    200, verdict inline      -> implemented
//   POST /v2/api/verifications/ng/company/basic           403 Permission denied
//   POST /v2/api/verifications/global/company-advance-check  403 Permission denied
//   bank account name-match         no path found (four guesses, all 404)
//   liveness                        browser SDK, resolved by webhook — not a call from here
//
// **The trap this adapter exists to avoid.** Youverify returns `allValidationPassed: true` when no
// `validations.data` was sent, and `dataValidation: true` means validation RAN, not that it passed:
// a submission whose first and last name both mismatch still comes back `dataValidation: true`.
// Reading either aggregate as a verdict — or omitting the claim — would attest a level 2 identity
// for anyone who typed a stranger's valid NIN. The mapper reads the per-field `validated` booleans.
import type { YouverifyCredentials } from '../../../../config/env.js';
import type { Logger } from '../../../../platform/logger.js';
import { providerRequest } from '../../../../platform/providers/http.js';
import { KycProviderNotConfiguredError } from '../../domain/errors.js';
import { mapIdentity, type YouverifyIdentityResponse } from './youverify.mapping.js';
import { bvnRequest, ninRequest, type YouverifyRequest } from './youverify.requests.js';
import type {
  BankMatchCheckResult,
  BusinessCheckResult,
  IdentityCheckResult,
  IdentityClaim,
  KycProviderAdapter,
  LivenessCheckResult,
} from '../../domain/provider.js';

/** What the key could not reach on 2026-11-19, in the words an operator needs to act on it. */
const NO_COMPANY_SCOPE = [
  'the company/CAC lookup scope on this Youverify API key (both /ng/company/basic and /global/company-advance-check answered 403 Permission denied)',
] as const;

const NO_BANK_ENDPOINT = [
  'the bank account name-match endpoint path from Youverify (four documented-looking paths all answered 404)',
] as const;

const LIVENESS_IS_A_WEBHOOK = [
  'nothing — Youverify liveness runs in the browser SDK and resolves over the webhook, so it is never called through this adapter',
] as const;

export function createYouverifyClient(credentials: YouverifyCredentials, logger: Logger): KycProviderAdapter {
  // Rejected promises rather than synchronous throws: a throw out of an adapter is an exception on
  // the worker's own call stack, not a failed job.
  const refuse = <T>(missing: readonly string[]): Promise<T> =>
    Promise.reject(new KycProviderNotConfiguredError('YOUVERIFY', missing));

  /**
   * One identity call.
   *
   * A non-2xx is left to throw. That is deliberate and it is the whole reason this helper exists
   * rather than a try/catch per method: Youverify's `402 Insufficient fund`, its `401`, and its
   * per-ID `429` ("try again after 10mins") are facts about our account and our call rate, not
   * about whether this person is who they say. Catching them and returning a `FAILED` verdict
   * would show a user a rejection they did not earn and burn their one in-flight slot. Throwing
   * leaves the request PROVIDER_PENDING, lets BullMQ retry, and leaves the expiry sweep as the
   * floor underneath it.
   */
  const identity = async (
    operation: string,
    build: (baseUrl: string, claim: IdentityClaim, token: string) => YouverifyRequest<unknown>,
    claim: IdentityClaim,
  ): Promise<IdentityCheckResult> => {
    const { url, headers, body } = build(credentials.baseUrl, claim, credentials.secretToken);
    const response = await providerRequest<YouverifyIdentityResponse>(logger, {
      provider: 'youverify',
      operation,
      method: 'POST',
      url,
      headers,
      body,
      // Not idempotent: a repeat is a second billed call, and Youverify rate-limits per ID anyway.
      idempotent: false,
    });
    return mapIdentity(response.body);
  };

  return {
    provider: 'YOUVERIFY',
    verifyNin: (claim) => identity('identity.nin', ninRequest, claim),
    verifyBvn: (claim) => identity('identity.bvn', bvnRequest, claim),
    checkLiveness: () => refuse<LivenessCheckResult>(LIVENESS_IS_A_WEBHOOK),
    verifyBusiness: () => refuse<BusinessCheckResult>(NO_COMPANY_SCOPE),
    verifyBankAccountName: () => refuse<BankMatchCheckResult>(NO_BANK_ENDPOINT),
  };
}
