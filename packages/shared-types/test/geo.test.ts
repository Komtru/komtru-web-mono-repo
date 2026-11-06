import { describe, expect, it } from 'vitest';
import {
  CITY_REQUEST_STATUSES,
  GEO_PAGE_LIMIT,
  cityNameSchema,
  cityRequestBodySchema,
  citySchema,
  normaliseCityName,
  stateSchema,
} from '../src/geo.js';

describe('normaliseCityName', () => {
  it.each([
    ['Port Harcourt', 'port harcourt'],
    ['  PORT   HARCOURT  ', 'port harcourt'],
    ['Port-Harcourt', 'port harcourt'],
    ['Ado-Ekiti', 'ado ekiti'],
    ["Ife's  Town.", 'ife s town'],
    ['Ìkẹja', 'ikeja'],
    ['Ibadan', 'ibadan'],
    ['İbadan', 'ibadan'],
  ])('%j becomes %j', (input, expected) => {
    expect(normaliseCityName(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const name of ['Ìkẹja', 'Port-Harcourt', ' Benin  City ']) {
      const once = normaliseCityName(name);
      expect(normaliseCityName(once)).toBe(once);
    }
  });

  it('only ever yields lower-case letters, digits and single spaces, so it is safe in a LIKE prefix', () => {
    expect(normaliseCityName('50%_off\\city')).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
  });

  it('turns a name with nothing searchable in it into the empty string', () => {
    expect(normaliseCityName('  --  ')).toBe('');
  });
});

describe('cityNameSchema', () => {
  it('trims and keeps the display spelling', () => {
    expect(cityNameSchema.parse('  Port Harcourt ')).toBe('Port Harcourt');
  });

  it.each(['', '  ', 'a', '--', '12', 'x'.repeat(81)])('rejects %j', (value) => {
    expect(cityNameSchema.safeParse(value).success).toBe(false);
  });
});

describe('geo schemas', () => {
  const id = '0190b0a0-0000-7000-8000-000000000001';

  it('a state and a city parse', () => {
    expect(stateSchema.safeParse({ id, code: 'LA', name: 'Lagos' }).success).toBe(true);
    expect(citySchema.safeParse({ id, stateId: id, name: 'Ikeja', active: true }).success).toBe(true);
  });

  it('a city request body takes a state id and a typed name, and nothing else', () => {
    expect(cityRequestBodySchema.safeParse({ stateId: id, cityName: 'Jos East' }).success).toBe(true);
    expect(cityRequestBodySchema.safeParse({ stateId: id, cityName: 'Jos', active: true }).success).toBe(
      false,
    );
  });

  it('knows the four request statuses in the order the ticket gives them', () => {
    expect(CITY_REQUEST_STATUSES).toEqual(['PENDING', 'ADDED', 'MERGED', 'REJECTED']);
  });

  it('asks for the largest page the platform allows, because a dropdown wants one request', () => {
    expect(GEO_PAGE_LIMIT).toBe(100);
  });
});
