import { describe, expect, it } from 'vitest';
import { addressLine, localPhone } from '../src/account/addresses/format';

describe('localPhone', () => {
  it('writes an E.164 Nigerian number the way the reference does, in groups', () => {
    expect(localPhone('+2348032214471')).toBe('0803 221 4471');
  });
  it('leaves what it cannot read exactly as it came', () => {
    expect(localPhone('+14155550123')).toBe('+14155550123');
    expect(localPhone('')).toBe('');
  });
});

describe('addressLine', () => {
  it('names the street, then city and state', () => {
    expect(addressLine({ streetLine: '12 Allen Avenue', cityName: 'Ikeja', stateName: 'Lagos' })).toBe(
      '12 Allen Avenue, Ikeja, Lagos',
    );
  });
});
