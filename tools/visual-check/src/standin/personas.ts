// The people a visual check can be signed in as. Every value is fixed — ids, names, facts — so a
// screenshot taken today is comparable with one taken next month. None of them is a real account, and
// none of them carries a credential: the stand-in answers for them, and nothing else does.
import type { SessionScope, ViewerFacts } from '@komtru/shared-types';

export const PERSONA_IDS = ['buyer', 'seller', 'merchant', 'staff'] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export interface Persona {
  id: PersonaId;
  /** The `sub` the access token carries, and the digest the sealed session is keyed by. A v7 UUID. */
  userId: string;
  /** The session scope the person signs in to. A consumer app refuses a `STAFF` session, and the reverse. */
  scope: SessionScope;
  displayName: string;
  /** What `GET /me/viewer` answers, and what the session hint seals for the shell. */
  facts: ViewerFacts;
}

/**
 * What a token is answered with. `with-trades` is the person's normal account; `no-trades` is the same
 * person before their first trade, which is the state the empty-state screens (AC1, H-03) are drawn in.
 *
 * The `application-*` scenarios are the merchant application (F-040) in each state the verification
 * screens draw. They keep the person's trades, and set the application the stand-in answers with.
 *
 * `dispute-mediation` and `dispute-decided` (F-032) put the case on the disputed trade in mediation and after a
 * decision, and give the seller's persona the seller side of that trade. They keep the rest of the person's trades.
 */
export const SCENARIO_IDS = [
  'with-trades',
  'no-trades',
  'application-draft',
  'application-in-review',
  'application-changes-requested',
  'application-rejected',
  'application-approved',
  'dispute-mediation',
  'dispute-decided',
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const PERSONAS: Readonly<Record<PersonaId, Persona>> = {
  buyer: {
    id: 'buyer',
    userId: '0190b0a0-0000-7000-8000-000000000101',
    scope: 'CONSUMER',
    displayName: 'Ada Okafor',
    facts: { hasSold: false, certifiedMerchant: false },
  },
  seller: {
    id: 'seller',
    userId: '0190b0a0-0000-7000-8000-000000000102',
    scope: 'CONSUMER',
    displayName: 'Tunde Bello',
    facts: { hasSold: true, certifiedMerchant: false },
  },
  merchant: {
    id: 'merchant',
    userId: '0190b0a0-0000-7000-8000-000000000103',
    scope: 'CONSUMER',
    displayName: 'Ngozi Eze',
    facts: { hasSold: true, certifiedMerchant: true },
  },
  staff: {
    id: 'staff',
    userId: '0190b0a0-0000-7000-8000-000000000104',
    scope: 'STAFF',
    displayName: 'Sam Adeyemi',
    // Staff have no consumer viewer. The facts are here so the type is whole; no consumer route reads them.
    facts: { hasSold: false, certifiedMerchant: false },
  },
};

export const isPersonaId = (value: string): value is PersonaId =>
  (PERSONA_IDS as readonly string[]).includes(value);

export const isScenarioId = (value: string): value is ScenarioId =>
  (SCENARIO_IDS as readonly string[]).includes(value);
