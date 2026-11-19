import { describe, expect, it } from 'vitest';
import { readContact } from '../../../src/modules/waitlist/domain/contact.js';

/**
 * The site asks for "phone or email" in one box, so this is what decides which it got and what two
 * spellings of the same thing have in common. Getting the second part wrong means messaging one
 * person twice at launch, or not at all.
 */
describe('readContact', () => {
  it('reads an email, and compares it case-insensitively', () => {
    expect(readContact('  Ada@Example.COM ')).toEqual({
      contact: 'Ada@Example.COM',
      contactKey: 'ada@example.com',
      channel: 'EMAIL',
    });
  });

  it.each([
    ['08012345678', '2348012345678'],
    ['0801 234 5678', '2348012345678'],
    ['0801-234-5678', '2348012345678'],
    ['+234 801 234 5678', '2348012345678'],
    ['2348012345678', '2348012345678'],
    ['8012345678', '2348012345678'],
  ])('reads %s as the same person', (typed, key) => {
    expect(readContact(typed)).toEqual({ contact: typed, contactKey: key, channel: 'PHONE' });
  });

  it('keeps what was typed, so we message the address they gave', () => {
    expect(readContact('+234 801 234 5678')?.contact).toBe('+234 801 234 5678');
  });

  /*
   * Ten digits starting with 0 is a number with a digit missing, not one with the trunk prefix
   * left off. Prefixing it would file it under a key no real Nigerian number can ever produce, so
   * the digits stand as they are and the two spellings stay distinct.
   */
  it('does not treat a short number as one missing its trunk prefix', () => {
    expect(readContact('0802000010')?.contactKey).toBe('0802000010');
    expect(readContact('08020000100')?.contactKey).toBe('2348020000100');
  });

  /*
   * Not a Nigerian number, and kept anyway: someone abroad waiting for Lagos to open is a real
   * signup, and the form's job is to collect a way to reach them, not to police the dialling plan.
   */
  it('keeps a number it does not recognise, as its own digits', () => {
    expect(readContact('+44 20 7946 0958')).toEqual({
      contact: '+44 20 7946 0958',
      contactKey: '442079460958',
      channel: 'PHONE',
    });
  });

  it.each(['', '   ', 'Ada', '12345', 'ada@example', 'call me'])('refuses %s', (value) => {
    expect(readContact(value)).toBeUndefined();
  });
});
