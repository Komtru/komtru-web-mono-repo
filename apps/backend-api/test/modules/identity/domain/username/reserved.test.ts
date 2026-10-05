// M1 §6.2. Reservation is matched on the skeleton, so one `admin` row has to catch `adm1n`,
// `a.d.m.i.n`, `admiiin` and `аdmin` with a Cyrillic а.
import { describe, expect, it } from 'vitest';
import {
  BLOCKED_SUBSTRING_SEED,
  RESERVED_USERNAME_SEED,
  blockedSubstringSkeletons,
  matchBlockedSubstring,
  reservedSkeletonRows,
} from '../../../../../src/modules/identity/domain/username/reserved.js';
import { skeleton, skeletonVariants } from '../../../../../src/modules/identity/domain/username/skeleton.js';

const reserved = new Set(reservedSkeletonRows().map((row) => row.usernameSkeleton));
const isReserved = (candidate: string) => skeletonVariants(candidate).some((v) => reserved.has(v));

describe('reserved namespace', () => {
  it('covers every §6.2 group', () => {
    const words = new Set(RESERVED_USERNAME_SEED.map((seed) => seed.word));
    for (const word of ['komtru', 'admin', 'support', 'escrow', 'payout', 'kyc', 'paystack', 'dhl'])
      expect(words.has(word)).toBe(true);
  });

  // The lifted code folded only the candidate and compared it against the reserved word's canonical
  // fold: narrow('fiutterwave') is 'fiuterwave', skeleton('flutterwave') is 'fluterwave', and the
  // two never meet — so @fiutterwave was claimable beside a reserved @flutterwave.
  it('reserves every fold of a seed word, not just the canonical one', () => {
    expect(reserved.has('fluterwave')).toBe(true);
    expect(reserved.has('fiuterwave')).toBe(true);
    expect(isReserved('fiutterwave')).toBe(true);
    expect(isReserved('waiiet')).toBe(true);
  });

  it('catches the §6.2 confusable variants of admin', () => {
    for (const attempt of ['admin', 'adm1n', 'a.d.m.i.n', 'admiin', 'admiiin', 'аdmin', 'ADMIN'])
      expect(isReserved(attempt)).toBe(true);
  });

  it('catches leet and homoglyph variants of the money words', () => {
    for (const attempt of ['escrow', '3scr0w', 'e5crow', 'p4yout', 'refund5'])
      expect(isReserved(attempt)).toBe(true);
  });

  it('leaves an ordinary handle alone', () => {
    for (const handle of ['janedoe', 'dellstore', 'bola.adeyemi', 'tunde_shop'])
      expect(isReserved(handle)).toBe(false);
  });

  it('emits one row per skeleton, so the primary key never collides', () => {
    const rows = reservedSkeletonRows();
    expect(new Set(rows.map((r) => r.usernameSkeleton)).size).toBe(rows.length);
    expect(rows.every((r) => r.usernameSkeleton.length > 0)).toBe(true);
    expect(rows.length).toBeGreaterThan(RESERVED_USERNAME_SEED.length);
  });

  it('is deterministic', () => {
    expect(reservedSkeletonRows()).toEqual(reservedSkeletonRows());
  });

  // Run collapsing turns `officialsupport` into `oficialsuport`, so the literal seed can never be a
  // substring of any skeleton: three of the four compound entries silently never matched.
  it('folds the blocked substrings so they can match a skeleton at all', () => {
    expect(blockedSubstringSkeletons()).toContain('oficialsuport');
    expect(blockedSubstringSkeletons()).toHaveLength(new Set(blockedSubstringSkeletons()).size);
    expect(BLOCKED_SUBSTRING_SEED).toContain('komtru');
  });

  it('matches a blocked substring anywhere in the handle', () => {
    expect(matchBlockedSubstring('my.official.support')).toBe('oficialsuport');
    expect(matchBlockedSubstring('komtru_deals')).toBe('komtru');
    expect(matchBlockedSubstring('k0mtrustore')).toBe('komtru');
    expect(matchBlockedSubstring('mykomtru')).toBe('komtru');
    expect(matchBlockedSubstring('janedoe')).toBeUndefined();
  });

  it('keeps the seeds themselves fold-stable', () => {
    for (const folded of blockedSubstringSkeletons()) expect(skeleton(folded)).toBe(folded);
  });
});
