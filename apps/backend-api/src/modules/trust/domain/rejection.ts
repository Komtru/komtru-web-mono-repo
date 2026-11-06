// Why a verification said no, as a closed taxonomy rather than a sentence.
//
// The ticket's wording is "rejection reasons structured for BVR1 and VF1", and those two screens are
// where the structure comes from — it is not invented here. Read them in
// `docs/design-reference/Komtru — UI Screens Living Master File.html`:
//
//  - **VF1 (Verification Failed)** renders: a row reading "Government-issued ID / Couldn't be
//    verified" with a `Failed` chip; a banner headed "Why this usually happens" whose body is
//    "Blurry photo, glare across the ID, or the name doesn't match what you entered — not a
//    judgment on the document itself."; then "Try again" with an upload control, a **Resubmit**
//    button and a **Contact support instead** button.
//  - **BVR1 (Business Verification Rejected)** renders: a row reading "Business registration / Not
//    approved" with a `Rejected` chip; a banner headed "Why" whose body is "The CAC number
//    submitted doesn't match any active registration on file. **This doesn't affect your personal
//    identity verification.**"; then a "What you can still do" table — trading as an individual
//    seller is *Unaffected*, the Verified Merchant badge is *Not available yet*, and Resubmit is
//    *Anytime, with corrected details*.
//
// So each screen needs five things from the backend and not one of them is a free-text blob: which
// surface renders it, how hard the no is, the banner heading, the banner body, what the user can do
// next, and — the field BVR1 exists to state — whether their identity level is affected. A column
// holding a provider's own sentence can answer none of those, which is why
// `verification_requests.rejection_reason` holds a CODE from this table and the copy lives here.
//
// Two consequences worth stating, because both are deliberate:
//
//  1. **The provider's own words are not persisted.** They are provider-speak ("NO_RECORD_FOUND",
//     "name_similarity below threshold"), they vary by vendor, and showing them to a seller is how a
//     user ends up reading a vendor's error taxonomy on the screen that gates their income. The
//     provider's text is available through `provider_reference` and `kyc_provider_calls` for
//     support; what the user sees is ours.
//  2. **A code is a contract.** Adding a member is safe; renaming or removing one breaks a row
//     already written, so `describeRejection` is total over the union and a stored code that is no
//     longer known falls back to `NEEDS_HUMAN_REVIEW` rather than throwing on a read path.
import type { VerificationType } from '../infrastructure/postgres/schema/enums.js';

export const REJECTION_CODES = [
  // --- VF1: the identity half (NIN, BVN, liveness) ------------------------------------------
  'ID_NOT_FOUND',
  'ID_NAME_MISMATCH',
  'ID_DOB_MISMATCH',
  'ID_IMAGE_UNCLEAR',
  'LIVENESS_FAILED',
  'LIVENESS_NO_IDENTIFIER',
  // --- BVR1: the business half (CAC, business bank name-match) -------------------------------
  'CAC_NOT_FOUND',
  'CAC_INACTIVE',
  'CAC_OFFICER_MISMATCH',
  'BANK_ACCOUNT_NOT_FOUND',
  'BANK_NAME_MISMATCH',
  // --- the rest of M6's checks ---------------------------------------------------------------
  'ADDRESS_PROOF_UNREADABLE',
  'SOCIAL_HANDLE_NOT_FOUND',
  'SOCIAL_CHALLENGE_NOT_FOUND',
  /** Two accounts published the same handle's code and the other one was settled first. */
  'SOCIAL_HANDLE_TAKEN',
  // --- shared --------------------------------------------------------------------------------
  /** The provider never answered and the sweep closed the request (§6.2). Not the user's fault. */
  'PROVIDER_UNAVAILABLE',
  /** Not a rejection: a MANUAL_REVIEW request, which is waiting on a person (§7). */
  'NEEDS_HUMAN_REVIEW',
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

/** Which screen renders it. The two the ticket names, plus the badge surface social proof lands on. */
export type RejectionSurface = 'VF1' | 'BVR1' | 'SOCIAL_PROOF';

/** The chip. VF1 says `Failed`, BVR1 says `Rejected`, and a review case is neither. */
export type RejectionOutcome = 'FAILED' | 'REJECTED' | 'UNDER_REVIEW';

/** The button the screen offers. VF1 and BVR1 both offer a resubmit and a route to support. */
export type RejectionRemedy =
  | 'RESUBMIT'
  | 'RESUBMIT_WITH_CLEARER_PHOTO'
  | 'RESUBMIT_WITH_DIFFERENT_ACCOUNT'
  | 'CONTACT_SUPPORT'
  | 'WAIT_FOR_REVIEW';

export interface RejectionReason {
  code: RejectionCode;
  surface: RejectionSurface;
  outcome: RejectionOutcome;
  /** VF1's "Why this usually happens" against BVR1's blunter "Why". */
  whyHeading: string;
  /** The banner body, in the user's language, with no provider name and no score in it. */
  why: string;
  remedy: RejectionRemedy;
  /**
   * BVR1's load-bearing sentence, as a boolean.
   *
   * A failed CAC check must not read as "your identity verification failed" — the seller can still
   * trade as an individual, and the screen says so. Only the identity checks set this true.
   */
  identityLevelAffected: boolean;
}

const REASONS: Record<RejectionCode, Omit<RejectionReason, 'code'>> = {
  ID_NOT_FOUND: {
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this usually happens',
    why: 'No record matched the number and name you entered. Check both and try again — this is not a judgment on the document itself.',
    remedy: 'RESUBMIT',
    identityLevelAffected: true,
  },
  ID_NAME_MISMATCH: {
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this usually happens',
    // VF1's third cause, verbatim in substance: "the name doesn't match what you entered".
    why: 'The name on the record does not match what you entered. Use the name exactly as it appears on your ID.',
    remedy: 'RESUBMIT',
    identityLevelAffected: true,
  },
  ID_DOB_MISMATCH: {
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this usually happens',
    why: 'The date of birth on the record does not match the one you entered.',
    remedy: 'RESUBMIT',
    identityLevelAffected: true,
  },
  ID_IMAGE_UNCLEAR: {
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this usually happens',
    // VF1's first two causes: "Blurry photo, glare across the ID".
    why: 'A blurry photo or glare across the ID is the usual cause — not a judgment on the document itself. Flat surface, good light, all four corners visible.',
    remedy: 'RESUBMIT_WITH_CLEARER_PHOTO',
    identityLevelAffected: true,
  },
  LIVENESS_FAILED: {
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this usually happens',
    why: 'The photo did not pass the liveness check, or the face did not match your ID closely enough. Good light and a clear view of your whole face fixes most of these.',
    remedy: 'RESUBMIT_WITH_CLEARER_PHOTO',
    identityLevelAffected: true,
  },
  LIVENESS_NO_IDENTIFIER: {
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this happened',
    // Not "usually": this one has exactly one cause, and telling the user it is probably their
    // lighting would send them to retake a photo that cannot pass until the earlier step is done.
    why: 'There is no verified NIN or BVN to match this photo against, so there was nothing to compare it to. Verify your NIN or BVN first.',
    remedy: 'RESUBMIT',
    identityLevelAffected: true,
  },

  CAC_NOT_FOUND: {
    surface: 'BVR1',
    outcome: 'REJECTED',
    whyHeading: 'Why',
    // BVR1's banner, verbatim. The second sentence is the whole reason this field is not a provider
    // error string: it is reassurance, and no provider will ever supply it.
    why: "The CAC number submitted doesn't match any active registration on file. This doesn't affect your personal identity verification.",
    remedy: 'RESUBMIT',
    identityLevelAffected: false,
  },
  CAC_INACTIVE: {
    surface: 'BVR1',
    outcome: 'REJECTED',
    whyHeading: 'Why',
    why: 'That registration exists but is not active at the CAC. This does not affect your personal identity verification.',
    remedy: 'CONTACT_SUPPORT',
    identityLevelAffected: false,
  },
  CAC_OFFICER_MISMATCH: {
    surface: 'BVR1',
    outcome: 'REJECTED',
    whyHeading: 'Why',
    why: 'You are not listed as an officer of that registration, so we cannot confirm the business is yours. This does not affect your personal identity verification.',
    remedy: 'CONTACT_SUPPORT',
    identityLevelAffected: false,
  },
  BANK_ACCOUNT_NOT_FOUND: {
    surface: 'BVR1',
    outcome: 'REJECTED',
    whyHeading: 'Why',
    why: 'That account number is not valid at the bank you chose. Check both and try again. This does not affect your personal identity verification.',
    remedy: 'RESUBMIT',
    identityLevelAffected: false,
  },
  BANK_NAME_MISMATCH: {
    surface: 'BVR1',
    outcome: 'REJECTED',
    whyHeading: 'Why',
    why: 'The name on that bank account is not your registered business name. Use an account in the business name. This does not affect your personal identity verification.',
    remedy: 'RESUBMIT_WITH_DIFFERENT_ACCOUNT',
    identityLevelAffected: false,
  },

  ADDRESS_PROOF_UNREADABLE: {
    surface: 'BVR1',
    outcome: 'REJECTED',
    whyHeading: 'Why',
    why: 'We could not read the address on the document you uploaded. A utility bill or bank statement from the last three months, with the address visible, works best.',
    remedy: 'RESUBMIT_WITH_CLEARER_PHOTO',
    identityLevelAffected: false,
  },
  SOCIAL_HANDLE_NOT_FOUND: {
    surface: 'SOCIAL_PROOF',
    outcome: 'FAILED',
    whyHeading: 'Why',
    why: 'We could not find that handle. Check the spelling, and make sure the account is public.',
    remedy: 'RESUBMIT',
    identityLevelAffected: false,
  },
  SOCIAL_CHALLENGE_NOT_FOUND: {
    surface: 'SOCIAL_PROOF',
    outcome: 'FAILED',
    whyHeading: 'Why',
    why: 'We could not find your code on that profile yet. Put it in your bio or post it, then check again — it can take a minute to appear.',
    remedy: 'RESUBMIT',
    identityLevelAffected: false,
  },

  SOCIAL_HANDLE_TAKEN: {
    surface: 'SOCIAL_PROOF',
    outcome: 'REJECTED',
    whyHeading: 'Why',
    why: 'That handle was verified on another account moments before yours. If it is yours, contact support and we will sort it out.',
    remedy: 'CONTACT_SUPPORT',
    identityLevelAffected: false,
  },

  PROVIDER_UNAVAILABLE: {
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this happened',
    // Honest about whose fault it is. Everything else on VF1 asks the user to change something;
    // this one asks them to do the same thing again, and saying so is the difference between a
    // retry and a support ticket.
    why: 'We did not hear back in time from the service that checks this. Nothing was wrong with what you sent — please try again.',
    remedy: 'RESUBMIT',
    identityLevelAffected: false,
  },
  NEEDS_HUMAN_REVIEW: {
    surface: 'VF1',
    outcome: 'UNDER_REVIEW',
    whyHeading: 'What happens now',
    why: 'Someone on our team is checking this by hand. You do not need to do anything, and resubmitting will not make it faster.',
    remedy: 'WAIT_FOR_REVIEW',
    identityLevelAffected: false,
  },
};

const KNOWN = new Set<string>(REJECTION_CODES);

export const isRejectionCode = (value: string): value is RejectionCode => KNOWN.has(value);

/**
 * The structured reason for a stored code.
 *
 * Total, and deliberately forgiving on the way in: this runs on `GET /verification/status`, and a
 * read path that throws on a row written by an older deploy turns a renamed code into an outage on
 * the one screen whose job is to explain a failure.
 */
export const describeRejection = (code: string): RejectionReason =>
  isRejectionCode(code)
    ? { code, ...REASONS[code] }
    : { code: 'NEEDS_HUMAN_REVIEW', ...REASONS.NEEDS_HUMAN_REVIEW };

/** Which codes a given check may produce, so a test can prove the mapping is not accidental. */
export const SURFACE_FOR_TYPE: Record<VerificationType, RejectionSurface> = {
  NIN: 'VF1',
  BVN: 'VF1',
  LIVENESS: 'VF1',
  DOCUMENT: 'VF1',
  CAC: 'BVR1',
  BANK_ACCOUNT_NAME_MATCH: 'BVR1',
  ADDRESS: 'BVR1',
  SOCIAL_PROOF: 'SOCIAL_PROOF',
};
