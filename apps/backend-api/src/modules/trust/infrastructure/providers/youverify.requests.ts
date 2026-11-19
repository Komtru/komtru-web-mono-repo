// URL, headers and body for every Youverify call. Pure: no network, no clock, no randomness.
//
// Split out for the reason T-040 split `cloudinary.signing.ts`: what we send a vendor is a thing to
// assert about in a unit test, and a request built inside the client can only be tested by making
// one.
import type { BankAccountClaim, IdentityClaim } from '../../domain/provider.js';

export interface YouverifyRequest<B> {
  url: string;
  headers: Record<string, string>;
  body: B;
}

export interface IdentityRequestBody {
  id: string;
  isSubjectConsent: true;
  validations?: { data?: { firstName?: string; lastName?: string; dateOfBirth?: string } };
}

export interface CompanyRequestBody {
  registrationNumber: string;
  isConsent: true;
}

export interface BankRequestBody {
  id: string;
  bankCode: string;
  isSubjectConsent: true;
}

const headers = (token: string): Record<string, string> => ({
  // Youverify authenticates with a bare `token` header, not `Authorization: Bearer`.
  token,
  'content-type': 'application/json',
  accept: 'application/json',
});

/**
 * The claim, always.
 *
 * `validations.data` is optional to Youverify and catastrophic to omit: a NIN sent without it comes
 * back `status: "found"` and `allValidationPassed: true`, which says only that nothing was asked.
 * The whole point of the call is "does this number belong to this person", so the names always
 * travel. A date of birth goes only when the claim has one — sending `undefined` would ask
 * Youverify to validate a field against nothing.
 */
function validations(claim: IdentityClaim): IdentityRequestBody['validations'] {
  return {
    data: {
      firstName: claim.firstName,
      lastName: claim.lastName,
      ...(claim.dateOfBirth === undefined ? {} : { dateOfBirth: claim.dateOfBirth }),
    },
  };
}

/**
 * `premiumNin` is deliberately absent rather than `false`.
 *
 * The documented schema calls it `premiumNIN` and the documented example calls it `premiumNin`; the
 * API accepts only the second and answers the first with `400 ValidationError: "premiumNIN" is not
 * allowed`. Since the default is false, the safest thing to send is neither.
 */
export function ninRequest(
  baseUrl: string,
  claim: IdentityClaim,
  token = '',
): YouverifyRequest<IdentityRequestBody> {
  return {
    url: `${baseUrl}/v2/api/identity/ng/nin`,
    headers: headers(token),
    body: { id: claim.identifier, isSubjectConsent: true, validations: validations(claim) },
  };
}

export function bvnRequest(
  baseUrl: string,
  claim: IdentityClaim,
  token = '',
): YouverifyRequest<IdentityRequestBody> {
  return {
    url: `${baseUrl}/v2/api/identity/ng/bvn`,
    headers: headers(token),
    body: { id: claim.identifier, isSubjectConsent: true, validations: validations(claim) },
  };
}

/**
 * The RC number travels with its entity prefix. Youverify's own validator refuses the bare form:
 * `Invalid registration number. Valid format => RCxxxx, BNxxxxx, ITxxxxx, LPxxxxx or LLPxxxxx`.
 *
 * Note `isConsent`, not `isSubjectConsent` — the company endpoints spell it differently from the
 * identity ones, and sending the identity spelling is a 400.
 */
export function companyRequest(
  baseUrl: string,
  rcNumber: string,
  token = '',
): YouverifyRequest<CompanyRequestBody> {
  return {
    url: `${baseUrl}/v2/api/verifications/ng/company/basic`,
    headers: headers(token),
    body: { registrationNumber: rcNumber, isConsent: true },
  };
}

/** Shape only. The real path is unknown — four plausible ones answered 404 — so this is unused. */
export function bankRequest(
  baseUrl: string,
  claim: BankAccountClaim,
  token = '',
): YouverifyRequest<BankRequestBody> {
  return {
    url: `${baseUrl}/v2/api/identity/ng/bank_account`,
    headers: headers(token),
    body: { id: claim.accountNumber, bankCode: claim.bankCode, isSubjectConsent: true },
  };
}
