// Turns the reviewed list in seed/nigeria-locations.seed.ts into rows. Kept apart from the list so
// the owner's file holds nothing but data.
import { normaliseCityName } from '@komtru/shared-types';
import { NIGERIA_LOCATIONS } from '../seed/nigeria-locations.seed.js';

export interface SeedStateRow {
  code: string;
  name: string;
  normalisedName: string;
}

export interface SeedCityRow {
  stateCode: string;
  name: string;
  normalisedName: string;
  /** Normalised search keys. */
  aliases: string[];
  /** Stable across a rename, so the seed inserts a seeded city once and never again. */
  seedKey: string;
}

export const seedKeyFor = (stateCode: string, cityName: string): string =>
  `${stateCode}:${normaliseCityName(cityName)}`;

export function seedRows(): { states: SeedStateRow[]; cities: SeedCityRow[] } {
  return {
    states: NIGERIA_LOCATIONS.map((state) => ({
      code: state.code,
      name: state.name,
      normalisedName: normaliseCityName(state.name),
    })),
    cities: NIGERIA_LOCATIONS.flatMap((state) =>
      [state.capital, ...state.cities].map((city) => ({
        stateCode: state.code,
        name: city.name,
        normalisedName: normaliseCityName(city.name),
        aliases: (city.aliases ?? []).map(normaliseCityName),
        seedKey: seedKeyFor(state.code, city.name),
      })),
    ),
  };
}
