import { describe, expect, it } from 'vitest';
import { cx } from '../../src/primitives/cx.js';

describe('cx', () => {
  it('joins the truthy parts', () => {
    expect(cx('a', 'b')).toBe('a b');
  });

  it('drops anything falsy, which is how a conditional utility is written', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('collapses the whitespace a multi-line template literal leaves behind', () => {
    expect(cx('  a   b  ', '\n c')).toBe('a b c');
  });

  it('is empty with nothing to join', () => {
    expect(cx()).toBe('');
  });
});
