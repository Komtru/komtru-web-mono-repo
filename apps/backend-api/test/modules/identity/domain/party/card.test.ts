import { describe, expect, it } from 'vitest';
import {
  badgesFor,
  partyCard,
  type PartyEnrichment,
  type PartyFacts,
} from '../../../../../src/modules/identity/domain/party/card.js';

const facts = (overrides: Partial<PartyFacts> = {}): PartyFacts => ({
  publicId: 'KMT-U-7F3K9Q',
  username: 'janedoe',
  displayName: 'Jane D.',
  avatarFileId: null,
  verificationLevel: 'CONTACT_VERIFIED',
  createdAt: new Date('2026-03-01T22:30:00Z'),
  emailVerified: true,
  phoneVerified: true,
  merchantCapabilityStatus: null,
  ...overrides,
});

const none: PartyEnrichment = { completedTrades: 0, merchantName: null, avatarUrl: null };

describe('badgesFor (M1 §8.2)', () => {
  it('never emits a badge above the level the user has attained', () => {
    expect(badgesFor('CONTACT_VERIFIED', { emailVerified: true, phoneVerified: true })).toEqual([
      'EMAIL_VERIFIED',
      'PHONE_VERIFIED',
    ]);
  });

  it('derives the levelled badges cumulatively up to the level', () => {
    expect(badgesFor('ENHANCED', { emailVerified: true, phoneVerified: false })).toEqual([
      'EMAIL_VERIFIED',
      'IDENTITY_VERIFIED',
      'BUSINESS_VERIFIED',
      'ENHANCED_DUE_DILIGENCE',
    ]);
  });

  it('reports an unverified contact as no badge even at a high level', () => {
    expect(badgesFor('BUSINESS_VERIFIED', { emailVerified: false, phoneVerified: false })).toEqual([
      'IDENTITY_VERIFIED',
      'BUSINESS_VERIFIED',
    ]);
  });

  it('emits nothing at all for an unverified account', () => {
    expect(badgesFor('UNVERIFIED', { emailVerified: false, phoneVerified: false })).toEqual([]);
  });

  it('treats a level it does not recognise as the floor rather than the ceiling', () => {
    // A level added by a later M6 ticket must not silently award every badge below it.
    expect(badgesFor('SOMETHING_NEW', { emailVerified: true, phoneVerified: false })).toEqual([
      'EMAIL_VERIFIED',
    ]);
  });
});

describe('partyCard (M1 §8.2)', () => {
  it('carries canBuy true for everyone, a certified merchant included', () => {
    expect(partyCard(facts({ merchantCapabilityStatus: 'ACTIVE' }), none).canBuy).toBe(true);
    expect(partyCard(facts({ merchantCapabilityStatus: 'SUSPENDED' }), none).canBuy).toBe(true);
    expect(partyCard(facts({ merchantCapabilityStatus: null }), none).canBuy).toBe(true);
  });

  it('is a merchant only while the capability is ACTIVE', () => {
    expect(partyCard(facts({ merchantCapabilityStatus: 'ACTIVE' }), none).isMerchant).toBe(true);
    expect(partyCard(facts({ merchantCapabilityStatus: 'REVOKED' }), none).isMerchant).toBe(false);
  });

  it('renders memberSince as a date and never a timestamp', () => {
    expect(partyCard(facts(), none).memberSince).toBe('2026-03-01');
  });

  it('takes the completed-trade count, the merchant name and the avatar from the enrichment', () => {
    const card = partyCard(facts({ merchantCapabilityStatus: 'ACTIVE' }), {
      completedTrades: 47,
      merchantName: "Jane's Gadgets",
      avatarUrl: 'https://cdn.example/a/signed',
    });
    expect(card).toMatchObject({
      completedTrades: 47,
      merchantName: "Jane's Gadgets",
      avatarUrl: 'https://cdn.example/a/signed',
    });
  });

  it('returns no field that could identify a contact', () => {
    // §8.2's "never returned by lookup, under any circumstance" list, as an assertion: this fails
    // the moment somebody adds an email, a phone or a legal name to the card.
    expect(Object.keys(partyCard(facts(), none)).sort()).toEqual([
      'avatarUrl',
      'badges',
      'canBuy',
      'completedTrades',
      'displayName',
      'isMerchant',
      'memberSince',
      'merchantName',
      'publicId',
      'username',
      'verificationLevel',
    ]);
  });
});
