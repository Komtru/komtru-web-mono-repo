import { normaliseCityName } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { seedKeyFor, seedRows } from '../../../src/modules/geo/domain/seed.js';
import { NIGERIA_LOCATIONS } from '../../../src/modules/geo/seed/nigeria-locations.seed.js';

describe('the Nigeria location seed list', () => {
  it('holds the 36 states and the FCT, once each', () => {
    expect(NIGERIA_LOCATIONS).toHaveLength(37);
    expect(new Set(NIGERIA_LOCATIONS.map((s) => s.code)).size).toBe(37);
    expect(new Set(NIGERIA_LOCATIONS.map((s) => normaliseCityName(s.name))).size).toBe(37);
    expect(NIGERIA_LOCATIONS.find((s) => s.code === 'FC')?.name).toBe('Federal Capital Territory');
  });

  it('gives every state a capital that is a city of that state', () => {
    for (const state of NIGERIA_LOCATIONS) {
      expect(state.capital.name.length, state.name).toBeGreaterThan(1);
    }
    expect(
      seedRows()
        .cities.filter((c) => c.stateCode === 'LA')
        .map((c) => c.name)[0],
    ).toBe('Ikeja');
  });

  it('never repeats a city within a state, and keeps every state under one dropdown page', () => {
    for (const state of NIGERIA_LOCATIONS) {
      const names = [state.capital, ...state.cities].map((c) => normaliseCityName(c.name));
      expect(new Set(names).size, state.name).toBe(names.length);
      expect(names.length, state.name).toBeLessThan(100);
    }
  });

  it('never lets an alias collide with a different city in its state, or repeat itself', () => {
    for (const state of NIGERIA_LOCATIONS) {
      const cities = [state.capital, ...state.cities];
      for (const city of cities) {
        const own = normaliseCityName(city.name);
        const aliases = (city.aliases ?? []).map(normaliseCityName);
        expect(new Set(aliases).size, city.name).toBe(aliases.length);
        for (const alias of aliases) {
          expect(alias, `${city.name} alias`).not.toBe(own);
          const clash = cities.find((other) => other !== city && normaliseCityName(other.name) === alias);
          expect(clash, `${state.name}: alias ${alias}`).toBeUndefined();
        }
      }
    }
  });

  it('lists a sensible number of cities for the owner to review, and keys each one stably', () => {
    const { cities } = seedRows();
    expect(cities.length).toBeGreaterThanOrEqual(100);
    expect(new Set(cities.map((c) => c.seedKey)).size).toBe(cities.length);
    expect(seedKeyFor('LA', 'Ikeja')).toBe('LA:ikeja');
    expect(seedKeyFor('RI', 'Port-Harcourt')).toBe('RI:port harcourt');
  });

  it('normalises aliases the way the typeahead will search them', () => {
    const ph = seedRows().cities.find((c) => c.seedKey === 'RI:port harcourt');
    expect(ph?.aliases).toEqual(['ph', 'portharcourt']);
  });
});
