import { describe, expect, it } from 'vitest';
import {
  MAX_ADDRESSES_PER_USER,
  addressSchema,
  createAddressBodySchema,
  updateAddressBodySchema,
} from '../src/addresses.js';
import { PROBLEM_CODES } from '../src/errors.js';

const id = '0190b0a0-0000-7000-8000-000000000001';
const valid = {
  label: 'Home',
  recipientName: 'Ada Obi',
  recipientPhone: '08012345678',
  streetLine: '12 Allen Avenue',
  landmark: 'Opposite the pharmacy',
  stateId: id,
  cityId: id,
};

describe('createAddressBodySchema', () => {
  it('accepts a full address and trims every string', () => {
    const parsed = createAddressBodySchema.parse({ ...valid, label: '  Home  ', streetLine: ' 12 Allen ' });
    expect(parsed.label).toBe('Home');
    expect(parsed.streetLine).toBe('12 Allen');
  });

  it('treats a blank or missing landmark as no landmark', () => {
    expect(createAddressBodySchema.parse({ ...valid, landmark: '   ' }).landmark).toBeNull();
    const { landmark: _omitted, ...rest } = valid;
    expect(createAddressBodySchema.parse(rest).landmark).toBeNull();
  });

  it('refuses blanks, over-long values and unknown fields', () => {
    expect(createAddressBodySchema.safeParse({ ...valid, label: '  ' }).success).toBe(false);
    expect(createAddressBodySchema.safeParse({ ...valid, label: 'x'.repeat(41) }).success).toBe(false);
    expect(createAddressBodySchema.safeParse({ ...valid, streetLine: 'x'.repeat(201) }).success).toBe(false);
    expect(createAddressBodySchema.safeParse({ ...valid, stateId: 'lagos' }).success).toBe(false);
    expect(createAddressBodySchema.safeParse({ ...valid, isDefault: true }).success).toBe(false);
  });

  it('takes an optional makeDefault flag', () => {
    expect(createAddressBodySchema.parse({ ...valid, makeDefault: true }).makeDefault).toBe(true);
  });
});

describe('updateAddressBodySchema', () => {
  it('needs at least one field', () => {
    expect(updateAddressBodySchema.safeParse({}).success).toBe(false);
    expect(updateAddressBodySchema.safeParse({ label: 'Work' }).success).toBe(true);
  });

  it('lets a landmark be cleared with null', () => {
    expect(updateAddressBodySchema.parse({ landmark: null }).landmark).toBeNull();
  });

  it('is strict', () => {
    expect(updateAddressBodySchema.safeParse({ label: 'Work', archivedAt: null }).success).toBe(false);
  });
});

describe('addressSchema', () => {
  it('describes what the API returns', () => {
    const parsed = addressSchema.safeParse({
      id,
      label: 'Home',
      recipientName: 'Ada Obi',
      recipientPhone: '+2348012345678',
      streetLine: '12 Allen Avenue',
      landmark: null,
      stateId: id,
      stateName: 'Lagos',
      cityId: id,
      cityName: 'Ikeja',
      cityActive: true,
      isDefault: true,
      archivedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('address limits', () => {
  it('caps a user at twenty live addresses', () => {
    expect(MAX_ADDRESSES_PER_USER).toBe(20);
  });
  it('has a problem code for the cap', () => {
    expect(PROBLEM_CODES).toContain('ADDRESS_LIMIT_REACHED');
  });
});
