// Whether this page has signed the person out on purpose. A refresh that comes back with no session ends the session
// too (`onSessionEnded`), and on a screen that stays up after a deliberate sign-out (a closed account's done screen) a
// reconnect or a refetch can cause one. That is not "your session expired", so it must not be told as one (SP-M16).
// Module state, not storage: it is true for this page load only, and a fresh load starts clean.
let signedOutOnPurpose = false;

export const markDeliberateSignOut = (): void => {
  signedOutOnPurpose = true;
};
export const wasDeliberateSignOut = (): boolean => signedOutOnPurpose;
/** For tests: a page load starts clean. */
export const resetDeliberateSignOut = (): void => {
  signedOutOnPurpose = false;
};
