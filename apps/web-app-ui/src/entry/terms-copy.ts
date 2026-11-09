// The Terms of Service and Privacy summary screen TOS1 shows, in the reference's own words.
//
// This is the copy the person reads before they agree. The version they agree to is not here: it is
// read from the platform (`GET /auth/terms`) at the moment they agree, because the platform refuses
// any other. When legal publishes new copy, it changes here and the operator moves
// `APP_TERMS_VERSION`, and TOS2 asks every existing account to accept it.

export interface TermsSection {
  heading: string;
  body: string;
}

export const TERMS_SECTIONS: readonly TermsSection[] = [
  {
    heading: '1. What Komtru does',
    body: 'Komtru holds payment for a Trade between a buyer and seller until both sides fulfil what was agreed, and releases funds accordingly.',
  },
  {
    heading: '2. Fees',
    body: 'A Buyer Protection Fee (1.5% of item price) applies to every funded Trade. Logistics fees are shown separately before you pay.',
  },
  {
    heading: '3. Your data',
    body: 'We collect identity, transaction, and device information to verify participants and prevent fraud. We never sell your data to third parties.',
  },
  {
    heading: '4. Trust Profile',
    body: "Your completed Trades, verification status, and dispute history form a Trust Profile visible to people you trade with — this can't be deleted while your account remains active.",
  },
  {
    heading: '5. Dispute resolution',
    body: 'Komtru TrustOps mediates disputes per published policy. Decisions can be appealed once per case.',
  },
];

/**
 * What changed in a published version, for screen TOS2's "What changed" rows, keyed by the Terms
 * version. A version with no entry gets no rows: listing changes nobody wrote down would be
 * inventing legal copy, so the screen says the Terms changed and links to them in full instead.
 */
export const TERMS_CHANGES: Readonly<Record<string, readonly { label: string; value: string }[]>> = {};
