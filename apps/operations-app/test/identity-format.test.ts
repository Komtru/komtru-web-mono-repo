import { describe, expect, it } from 'vitest';
import {
  flagStatusLabel,
  isBusiness,
  providerResult,
  shortUser,
  verificationLabel,
  waitingHours,
  waitingLabel,
} from '../src/identity/format';

const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('identity review wording', () => {
  it('names each verification type in words, and an unknown one by its humanised code', () => {
    expect(verificationLabel('BVN')).toBe('Bank Verification Number');
    expect(verificationLabel('CAC')).toBe('Business registration (CAC)');
    expect(verificationLabel('BANK_ACCOUNT_NAME_MATCH')).toBe('Bank account name');
    expect(verificationLabel('NEW_THING')).toBe('New thing');
  });

  it('treats KYB cases as businesses and everything else as individuals', () => {
    expect(isBusiness('KYB')).toBe(true);
    expect(isBusiness('IDENTITY')).toBe(false);
  });

  it('says how long a request has waited, and whether that is over a day', () => {
    expect(waitingLabel('2026-11-10T09:00:00.000Z', NOW)).toBe('3h');
    expect(waitingLabel('2026-11-09T09:30:00.000Z', NOW)).toBe('1d');
    expect(waitingHours('2026-11-09T11:00:00.000Z', NOW)).toBe(25);
    expect(waitingHours('2026-11-10T12:30:00.000Z', NOW)).toBe(0);
  });

  it('reads a provider result from what the queue actually carries', () => {
    expect(providerResult({ duplicateFlagStatus: null })).toEqual({
      label: 'Needs a person',
      tone: 'awaiting',
    });
    expect(providerResult({ duplicateFlagStatus: 'OPEN' })).toEqual({
      label: 'Duplicate identity',
      tone: 'risk',
    });
    expect(providerResult({ duplicateFlagStatus: 'ESCALATED' }).label).toBe('Duplicate identity, escalated');
  });

  it('shortens a user id to the tail a person can read out', () => {
    expect(shortUser('0190b0a0-0000-7000-8000-00000000abcd')).toBe('…00abcd');
  });

  it('words every flag status', () => {
    expect(flagStatusLabel('CLEARED_FALSE_POSITIVE')).toBe('Cleared as a false positive');
    expect(flagStatusLabel('CONFIRMED_DUPLICATE')).toBe('Confirmed duplicate');
  });
});
