import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  FILE_CATEGORIES,
  FILE_VISIBILITY_BY_CATEGORY,
  isAllowedUpload,
  type UploadTarget,
} from '../src/files.js';

/**
 * The bug this file exists to prevent, written down.
 *
 * Four upload screens shipped asking for `{ category: 'OTHER', visibility: 'PRIVATE_CASE' }`. No
 * release has ever accepted that pair — `OTHER` is the escape hatch and may only be owner-private
 * or staff-internal — so every attempt came back 403 "That file cannot be uploaded that way", on a
 * page a buyer was standing in front of trying to finish a trade.
 */
describe('UploadTarget', () => {
  it('accepts a pair the platform allows', () => {
    expectTypeOf<{ category: 'PROOF_OF_DELIVERY'; visibility: 'PRIVATE_CASE' }>().toExtend<UploadTarget>();
    expectTypeOf<{ category: 'PROFILE_PHOTO'; visibility: 'PUBLIC' }>().toExtend<UploadTarget>();
  });

  /* The whole point: this is now a compile error, not a 403. */
  it('rejects OTHER + PRIVATE_CASE, the pair that shipped', () => {
    expectTypeOf<{ category: 'OTHER'; visibility: 'PRIVATE_CASE' }>().not.toExtend<UploadTarget>();
  });

  it('rejects publishing a KYC document', () => {
    expectTypeOf<{ category: 'KYC_DOCUMENT'; visibility: 'PUBLIC' }>().not.toExtend<UploadTarget>();
  });
});

describe('the pairing table', () => {
  it('covers every category, so a new one cannot be added without deciding its visibility', () => {
    expect(Object.keys(FILE_VISIBILITY_BY_CATEGORY).sort()).toEqual([...FILE_CATEGORIES].sort());
  });

  it('never leaves a category with nowhere to go', () => {
    for (const [category, allowed] of Object.entries(FILE_VISIBILITY_BY_CATEGORY)) {
      expect(allowed.length, category).toBeGreaterThan(0);
    }
  });

  /* Evidence on a trade is always PRIVATE_CASE, so these three must allow it or the trade flow breaks. */
  it.each(['DISPUTE_EVIDENCE', 'PROOF_OF_DELIVERY', 'CUSTODY_EVIDENCE'] as const)(
    '%s can be PRIVATE_CASE',
    (category) => expect(isAllowedUpload(category, 'PRIVATE_CASE')).toBe(true),
  );

  it('keeps the escape hatch narrow', () => {
    expect(isAllowedUpload('OTHER', 'PRIVATE_CASE')).toBe(false);
    expect(isAllowedUpload('OTHER', 'PUBLIC')).toBe(false);
    expect(isAllowedUpload('OTHER', 'PRIVATE_OWNER')).toBe(true);
  });
});
