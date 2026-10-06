// M1 §6.3. The skeleton is what stands between a username system and a fraud surface, so these
// assert the folded VALUE, not merely that two handles collided.
import { describe, expect, it } from 'vitest';
import {
  isConfusable,
  isKnownSkeletonVersion,
  skeleton,
  skeletonNarrow,
  skeletonVariants,
} from '../../../../../src/modules/identity/domain/username/skeleton.js';

describe('skeleton', () => {
  it('folds the §6.3 worked example to delstoreng', () => {
    for (const handle of ['dellstore_ng', 'dell.store.ng', 'dellst0re_ng', 'de11store.ng', 'dellstoreee_ng'])
      expect(skeleton(handle)).toBe('delstoreng');
  });

  it('folds the §17 collision set to one skeleton', () => {
    for (const handle of ['dellstore', 'dell.store', 'dellst0re', 'de11st0re', 'dellstoree'])
      expect(skeleton(handle)).toBe('delstore');
  });

  it('folds Cyrillic and Greek homoglyphs onto ASCII', () => {
    expect(skeleton('аdmin')).toBe('admin');
    expect(skeleton('αdmin')).toBe('admin');
  });

  it('strips diacritics and NFKC-normalises', () => {
    expect(skeleton('jané')).toBe('jane');
    expect(skeleton('ｊａｎｅ')).toBe('jane');
  });

  it('applies the digit overlay from §6.3', () => {
    expect(skeleton('4b3')).toBe('abe');
    expect(skeleton('5678')).toBe('sgtb');
    expect(skeleton('9o')).toBe('go');
  });

  it('maps the multi-character confusables', () => {
    expect(skeleton('rnodern')).toBe('modem');
    expect(skeleton('vvide')).toBe('wide');
    expect(skeleton('clothing')).toBe('dothing');
  });

  it('is deterministic and version-pinned', () => {
    expect(skeleton('dellstore', 1)).toBe(skeleton('dellstore'));
    expect(() => skeleton('dellstore', 2)).toThrow(/version 2/);
    expect(isKnownSkeletonVersion(1)).toBe(true);
    expect(isKnownSkeletonVersion(2)).toBe(false);
  });

  // collapseRuns compared a code point against the last UTF-16 code unit, so a run of astral
  // characters never collapsed. Nothing can claim such a handle today, but the reserved list is
  // matched on the skeleton of arbitrary input.
  it('collapses runs of astral characters like runs of ASCII', () => {
    expect(skeleton('a\u{1F642}\u{1F642}b')).toBe('a\u{1F642}b');
  });

  it('reports a confusable pair', () => {
    expect(isConfusable('dellstore', 'de11st0re')).toBe(true);
    expect(isConfusable('dellstore', 'janedoe')).toBe(false);
  });

  it('offers a narrow fold that merges the i/l/1 class without disturbing the canonical one', () => {
    expect(skeleton('adm1n')).toBe('admln');
    expect(skeletonNarrow('adm1n')).toBe('admin');
    expect(skeletonNarrow('admiiin')).toBe('admin');
    expect(skeletonVariants('adm1n')).toEqual(['admln', 'admin']);
    expect(skeletonVariants('jane')).toEqual(['jane']);
  });

  // The multigraph pass and the narrow-glyph pass are two independent axes. A handle that takes one
  // substitution from each lands between them: before the passes were composed, `adrn1n` folded to
  // `admln` and `adrnin` and matched neither, so it was claimable beside a reserved `admin`.
  it('composes the multigraph and narrow passes, in both orders', () => {
    const meets = (a: string, b: string) => {
      const folds = new Set(skeletonVariants(b));
      return skeletonVariants(a).some((fold) => folds.has(fold));
    };
    for (const [attempt, target] of [
      ['adrn1n', 'admin'],
      ['vvailet', 'wallet'],
      ['cl1spute', 'dispute'],
      ['rna1l', 'mail'],
      ['cornpl1ance', 'compliance'],
    ] as const)
      expect(meets(attempt, target)).toBe(true);
    // The specific composition that used to escape: neither single pass reaches it.
    expect(skeletonVariants('adrn1n')).toContain('admin');
    expect(skeleton('adrn1n')).toBe('admln');
    expect(skeletonNarrow('adrn1n')).toBe('adrnin');
  });

  it('still returns the canonical fold first, because that is the stored value', () => {
    expect(skeletonVariants('adrn1n')[0]).toBe(skeleton('adrn1n'));
    expect(skeletonVariants('dellstore_ng')[0]).toBe('delstoreng');
  });
});
