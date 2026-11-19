// Youverify's JSON onto the adapter's result types. Pure, and the only file in the program that
// knows what this vendor's fields mean.
//
// ## The trap
//
// Youverify reports validation three ways, and two of them are liars for our purposes:
//
//   `allValidationPassed`  true when NOTHING was validated — "no checks failed" includes "no checks"
//   `dataValidation`       true when validation RAN, regardless of whether it passed
//   `validations.data.<field>.validated`  the actual per-field answer
//
// Only the third is read here. The first two are tested against in `youverify-mapping.test.ts`
// precisely because they are the shape a reasonable implementation would reach for first: a NIN
// submitted with no claim returns `found` + `allValidationPassed: true`, and treating that as a
// pass would attest a level 2 identity for anyone who typed a stranger's valid number.
//
// A `found` identity with no `validations` block is therefore NOT a pass. It is `LOW_CONFIDENCE`,
// which `decideIdentityOutcome` sends to a human — the §7 posture, because the thing that produced
// it is a bug on our side or a silently ignored claim on theirs, and neither is the user's fault.
import type { IdentityCheckResult } from '../../domain/provider.js';
import type { RejectionCode } from '../../domain/rejection.js';

export interface YouverifyValidatedField {
  validated: boolean;
  value?: string | null;
}

export interface YouverifyIdentityResponse {
  success?: boolean;
  statusCode?: number;
  message?: string;
  data: {
    id: string;
    status: string;
    reason?: string | null;
    dataValidation?: boolean;
    selfieValidation?: boolean;
    allValidationPassed?: boolean;
    type?: string;
    idNumber?: string;
    firstName?: string | null;
    lastName?: string | null;
    validations?: {
      data?: Record<string, YouverifyValidatedField | undefined>;
      validationMessages?: string | null;
    };
  };
}

/** The identity fields a claim can assert, and the rejection each one's failure maps to. */
const NAME_FIELDS = ['firstName', 'lastName', 'middleName'] as const;

export function mapIdentity(response: YouverifyIdentityResponse): IdentityCheckResult {
  const { data } = response;
  const providerReference = data.id;

  if (data.status !== 'found') {
    return {
      verdict: 'FAILED',
      providerReference,
      failureCode: 'ID_NOT_FOUND',
      ...(data.reason ? { failureReason: data.reason } : {}),
    };
  }

  const fields = data.validations?.data;
  if (!fields || Object.keys(fields).length === 0) {
    // Found, but nothing was checked. See the trap above: never a pass.
    return {
      verdict: 'LOW_CONFIDENCE',
      providerReference,
      failureReason: 'the identity exists but no field was validated; the claim was not sent or was ignored',
    };
  }

  const failed = (name: string): boolean => fields[name]?.validated === false;
  const dobField = fields.dateOfBirth;
  const nameFailed = NAME_FIELDS.some((name) => failed(name));
  const dobFailed = failed('dateOfBirth');

  if (nameFailed || dobFailed) {
    // A name mismatch is reported first: it is the stronger signal that this is not the person, and
    // VF1's copy for it tells the user to check the spelling on their ID rather than their birthday.
    const failureCode: RejectionCode = nameFailed ? 'ID_NAME_MISMATCH' : 'ID_DOB_MISMATCH';
    return {
      verdict: 'FAILED',
      providerReference,
      failureCode,
      ...(dobField === undefined ? {} : { dobMatch: dobField.validated }),
      ...(data.validations?.validationMessages ? { failureReason: data.validations.validationMessages } : {}),
    };
  }

  return {
    verdict: 'PASSED',
    providerReference,
    ...(dobField === undefined ? {} : { dobMatch: dobField.validated }),
  };
}
