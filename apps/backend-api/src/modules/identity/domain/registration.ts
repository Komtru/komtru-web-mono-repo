// What a client should ask for next, as one pure function over the account's state (M1 §9.3).
//
// It lives here rather than in each controller because three endpoints answer it — register,
// verify-otp and login — and three copies of an ordering rule become three different orderings.
export type NextStep =
  | 'ACCEPT_TERMS'
  | 'VERIFY_EMAIL'
  | 'VERIFY_PHONE'
  | 'SET_PASSWORD'
  | 'CHOOSE_USERNAME'
  | 'ADD_EMAIL'
  | 'ADD_PHONE'
  | 'DONE';

export interface OnboardingState {
  emailVerified: boolean;
  phoneVerified: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasPassword: boolean;
  hasUsername: boolean;
  termsUpToDate: boolean;
}

/**
 * §9.3's order, with terms in front of it.
 *
 *   ACCEPT_TERMS → VERIFY_* → SET_PASSWORD → CHOOSE_USERNAME → ADD_* → DONE
 *
 * Terms first because screen TOS2 blocks the whole app: there is no lawful basis for processing
 * while the user has not accepted the current documents, so asking them to pick a handle in the
 * meantime would be asking them to do something we may not yet record.
 *
 * `CHOOSE_USERNAME` comes before the second channel because §9.3 marks it blocking and the second
 * channel merely gates level 1 — a user with one verified channel can already browse and be tagged.
 */
export function nextStep(state: OnboardingState): NextStep {
  if (!state.termsUpToDate) return 'ACCEPT_TERMS';

  // The channel they started with. A row that exists but is unverified is the one to chase; a
  // channel with no row at all is the SECOND channel and is handled further down.
  if (state.hasPhone && !state.phoneVerified) return 'VERIFY_PHONE';
  if (state.hasEmail && !state.emailVerified) return 'VERIFY_EMAIL';

  if (!state.hasPassword) return 'SET_PASSWORD';
  if (!state.hasUsername) return 'CHOOSE_USERNAME';

  if (!state.hasEmail) return 'ADD_EMAIL';
  if (!state.hasPhone) return 'ADD_PHONE';

  return 'DONE';
}
