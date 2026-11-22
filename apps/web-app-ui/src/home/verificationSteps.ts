// F-084: which verification steps a person still owes, for the "Finish verifying" card on Home and Shop.
//
// Information only. Every refusal stays the server's (`trades/domain/eligibility.ts`): a buyer needs both
// contacts confirmed to send and fund, and a trade can't be funded until its seller's ID is verified. This
// module reads the same facts VF1 reads and says which of those steps are still open, nothing more. Pure, so
// the rules are tested without a DOM.
import type { ContactChannelState, VerificationStatus } from '@komtru/api-client';

export type DashboardSide = 'BUYER' | 'SELLER';
export type StepId = 'email' | 'phone' | 'identity';
/** `todo`: nothing sent yet. `in_review`: a check is on its way. `rejected`: the last check failed. */
export type StepState = 'todo' | 'in_review' | 'rejected';

export interface VerificationStep {
  id: StepId;
  title: string;
  /** Why this step matters, in one line: what it lets the person do. */
  reason: string;
  state: StepState;
  /** Required on this side: the card can't be put away while it is open. */
  required: boolean;
  href: string;
}

/** VF1's sections, so each step opens where it is done. */
export const CONTACT_SECTION_HREF = '/account/verification#contact';
export const IDENTITY_SECTION_HREF = '/account/verification#identity';

/** The levels at which the ID step is done. Business verification sits above identity, so it counts. */
const ID_DONE: ReadonlySet<string> = new Set(['IDENTITY_VERIFIED', 'BUSINESS_VERIFIED']);

/** The checks that make up "verify your ID" on VF1: an ID number (either kind) and the selfie. */
const ID_CHECKS: ReadonlySet<string> = new Set(['NIN', 'BVN', 'LIVENESS']);

export interface Facts {
  contacts: { email: ContactChannelState; phone: ContactChannelState };
  verificationLevel: string;
}

const CONTACT_REASON = 'You need both confirmed to send and pay for trades.';

function contactSteps(contacts: Facts['contacts']): VerificationStep[] {
  const { email, phone } = contacts;
  const steps: VerificationStep[] = [];
  // Whichever one is proven is the one the person signed up with; the step names it, so the other one makes sense.
  if (!email.verified) {
    steps.push({
      id: 'email',
      title: email.present ? 'Confirm your email' : 'Add and confirm your email',
      reason: phone.verified
        ? `You signed up with your phone. Confirm your email so we can send your receipts. ${CONTACT_REASON}`
        : CONTACT_REASON,
      state: 'todo',
      required: true,
      href: CONTACT_SECTION_HREF,
    });
  }
  if (!phone.verified) {
    steps.push({
      id: 'phone',
      title: phone.present ? 'Confirm your phone' : 'Add and confirm your phone',
      reason: email.verified
        ? `You signed up with your email. Confirm your phone so we can reach you about a trade. ${CONTACT_REASON}`
        : CONTACT_REASON,
      state: 'todo',
      required: true,
      href: CONTACT_SECTION_HREF,
    });
  }
  return steps;
}

/**
 * Where the ID check stands, from the platform's in-flight and rejected checks. A check on its way wins over an
 * older rejection of the same kind (`activeRejections` drops those), and a rejection a person is still looking at
 * (`UNDER_REVIEW`) is in review, not failed.
 */
function identityState(status: VerificationStatus, rejections: VerificationStatus['rejections']): StepState {
  if (status.inFlight.some((request) => ID_CHECKS.has(request.type))) return 'in_review';
  const mine = rejections.filter((rejection) => ID_CHECKS.has(rejection.type));
  if (mine.some((rejection) => rejection.reason.outcome !== 'UNDER_REVIEW')) return 'rejected';
  if (mine.length > 0) return 'in_review';
  return 'todo';
}

/**
 * The steps still owed on one side, in the order they are done: contacts first (they gate sending and paying),
 * then ID. `rejections` is VF1's `activeRejections(status)`, passed in so this module stays free of the screen.
 */
export function stepsOwed(
  facts: Facts,
  status: VerificationStatus,
  rejections: VerificationStatus['rejections'],
  side: DashboardSide,
): VerificationStep[] {
  const steps = contactSteps(facts.contacts);
  if (!ID_DONE.has(facts.verificationLevel)) {
    steps.push({
      id: 'identity',
      title: 'Verify your ID',
      reason:
        side === 'SELLER'
          ? 'Buyers can’t pay into a trade you’re selling until your ID is verified.'
          : 'Recommended. A verified ID raises your trust with the people you trade with.',
      state: identityState(status, rejections),
      required: side === 'SELLER',
      href: IDENTITY_SECTION_HREF,
    });
  }
  return steps;
}
