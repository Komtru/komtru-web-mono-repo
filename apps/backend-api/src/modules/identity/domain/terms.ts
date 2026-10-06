// The lawful-basis capture NDPA §15 asks for: which version of the Terms and the Privacy Policy a
// user accepted, when, and from where. M1 §10.1 carries `acceptedTermsVersion` on registration
// (screen TOS1) and §15 names `terms_version` and `privacy_version` as the record.
//
// The versions live here rather than in a database table because the documents themselves are not
// data this system owns: they are legal copy, published with the app, and a version is a date in a
// file somebody reviewed. `APP_TERMS_VERSION` / `APP_PRIVACY_VERSION` override them for an
// environment that has shipped newer copy, which is what makes screen TOS2 reachable without a
// deploy of this service.

/** The versions this build ships. M1 §10.1's example body uses this date. */
export const DEFAULT_TERMS_VERSION = '2026-08-01';
export const DEFAULT_PRIVACY_VERSION = '2026-08-01';

/**
 * The versions in force, with an operator's `APP_TERMS_VERSION` / `APP_PRIVACY_VERSION` override
 * applied. Identity owns the default, not `config/env.ts`: a legal document's version is a fact
 * about the copy this module serves, and the config loader reaching into a module for a constant
 * would invert the dependency the module-boundaries rule exists to keep straight.
 */
export const resolveTermsVersions = (override: {
  version?: string;
  privacyVersion?: string;
}): { termsVersion: string; privacyVersion: string } => ({
  termsVersion: override.version ?? DEFAULT_TERMS_VERSION,
  privacyVersion: override.privacyVersion ?? DEFAULT_PRIVACY_VERSION,
});

export interface TermsState {
  termsVersion: string;
  privacyVersion: string;
  acceptedTermsVersion: string | null;
  acceptedPrivacyVersion: string | null;
}

/**
 * Both documents, not either: TOS1 asks for two separate acknowledgements and §15 stores two
 * columns, so a user who accepted the Terms and never saw the Privacy Policy has not given a
 * lawful basis for processing.
 */
export const termsUpToDate = (state: TermsState): boolean =>
  state.acceptedTermsVersion === state.termsVersion && state.acceptedPrivacyVersion === state.privacyVersion;
