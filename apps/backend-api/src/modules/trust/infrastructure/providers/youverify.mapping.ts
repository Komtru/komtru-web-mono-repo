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

/**
 * The two fields `ninRequest`/`bvnRequest` ALWAYS send, and therefore the two this mapper is
 * entitled to demand back. `middleName` is never sent, so it is deliberately not here — listing it
 * would read as a claim this code does not make.
 */
const REQUIRED_NAME_FIELDS = ['firstName', 'lastName'] as const;

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

  /*
    Positive, not the absence of a negative.

    Asking "is any field `validated === false`" treats a field the provider did not return as
    agreement — which is `allValidationPassed`'s exact error ("no checks failed" includes "no
    checks") reproduced one level down. Youverify echoes only the fields it could evaluate, so a
    record with a null surname comes back carrying `firstName` alone; under the old reading that
    was a PASS on a first name, and a verified identity for whoever typed a stranger's NIN.
  */
  const matched = (name: string): boolean => fields[name]?.validated === true;
  const dobField = fields.dateOfBirth;
  const nameFailed = REQUIRED_NAME_FIELDS.some((name) => !matched(name));
  // A date of birth is only claimed when the caller supplied one, so it is judged only if returned.
  const dobFailed = dobField !== undefined && dobField.validated !== true;

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
