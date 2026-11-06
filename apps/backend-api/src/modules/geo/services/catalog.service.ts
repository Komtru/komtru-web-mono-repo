// The read side of the catalog: what every dropdown, address form and hub picker loads. Public views
// carry only what a form needs (ids, names, the active flag); nothing here reads a person.
//
// Every list is a keyset page on (normalised name, id), cached in Redis under the catalog version, so
// any catalog change retires every cached page (infrastructure/redis/cache.ts).
import { normaliseCityName, type Paginated } from '@komtru/shared-types';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { nameCursorKey, readNameCursor } from '../domain/catalog.js';
import { cityNotFound, stateNotFound } from '../domain/errors.js';
import { cities } from '../infrastructure/postgres/schema/cities.js';
import { states } from '../infrastructure/postgres/schema/states.js';
import type { GeoCache } from '../infrastructure/redis/cache.js';

export interface StateView {
  id: string;
  code: string;
  name: string;
}

export interface CityView {
  id: string;
  stateId: string;
  name: string;
  active: boolean;
}

/** A city with its state's name, which is what disambiguates "Oyo" the town from "Oyo" the state. */
export interface CityWithState extends CityView {
  stateName: string;
}

export interface PageInput {
  limit: number;
  cursor?: CursorKey | undefined;
}

const afterCursor = (
  nameColumn: typeof cities.normalisedName | typeof states.normalisedName,
  idColumn: typeof cities.id | typeof states.id,
  cursor: CursorKey | undefined,
): SQL | undefined => {
  const after = readNameCursor(cursor);
  return after ? sql`(${nameColumn}, ${idColumn}) > (${after.name}, ${after.id}::uuid)` : undefined;
};

const cursorTag = (cursor: CursorKey | undefined): string => (cursor ? JSON.stringify(cursor) : '-');

export async function listStates(
  db: Db,
  cache: GeoCache,
  { limit, cursor }: PageInput,
): Promise<Paginated<StateView>> {
  return cache.remember(`states:${limit}:${cursorTag(cursor)}`, async () => {
    const rows = await db
      .select({ id: states.id, code: states.code, name: states.name, normalisedName: states.normalisedName })
      .from(states)
      .where(afterCursor(states.normalisedName, states.id, cursor))
      .orderBy(asc(states.normalisedName), asc(states.id))
      .limit(limit + 1);
    const page = cursorPage(rows, limit, nameCursorKey);
    return {
      items: page.items.map(({ id, code, name }) => ({ id, code, name })),
      nextCursor: page.nextCursor,
    };
  });
}

/** The active cities of one state, for the second dropdown. An unknown state is a 404. */
export async function listStateCities(
  db: Db,
  cache: GeoCache,
  stateId: string,
  { limit, cursor }: PageInput,
): Promise<Paginated<CityView>> {
  return cache.remember(`state:${stateId}:cities:${limit}:${cursorTag(cursor)}`, async () => {
    const [state] = await db.select({ id: states.id }).from(states).where(eq(states.id, stateId));
    if (!state) throw stateNotFound();
    const rows = await db
      .select({
        id: cities.id,
        stateId: cities.stateId,
        name: cities.name,
        active: cities.active,
        normalisedName: cities.normalisedName,
      })
      .from(cities)
      .where(
        and(
          eq(cities.stateId, stateId),
          eq(cities.active, true),
          afterCursor(cities.normalisedName, cities.id, cursor),
        ),
      )
      .orderBy(asc(cities.normalisedName), asc(cities.id))
      .limit(limit + 1);
    const page = cursorPage(rows, limit, nameCursorKey);
    return {
      items: page.items.map(({ id, stateId: sid, name, active }) => ({ id, stateId: sid, name, active })),
      nextCursor: page.nextCursor,
    };
  });
}

export interface SearchInput extends PageInput {
  q?: string | undefined;
  stateId?: string | undefined;
}

/**
 * Typeahead: active cities whose name, or any alias, starts with what was typed. `q` is normalised
 * first, and the normalised form holds only [a-z0-9 ], so it is safe in a LIKE prefix as it stands.
 * No `q` lists every active city (still paged), which is the "all cities" picker.
 */
export async function searchCities(
  db: Db,
  cache: GeoCache,
  { q, stateId, limit, cursor }: SearchInput,
): Promise<Paginated<CityWithState>> {
  const key = normaliseCityName(q ?? '');
  return cache.remember(
    `cities:${stateId ?? '*'}:${key === '' ? '*' : key}:${limit}:${cursorTag(cursor)}`,
    async () => {
      const prefix = `${key}%`;
      const match =
        key === ''
          ? undefined
          : sql`(${cities.normalisedName} LIKE ${prefix} OR EXISTS (SELECT 1 FROM unnest(${cities.aliases}) AS alias WHERE alias LIKE ${prefix}))`;
      const rows = await db
        .select({
          id: cities.id,
          stateId: cities.stateId,
          name: cities.name,
          active: cities.active,
          stateName: states.name,
          normalisedName: cities.normalisedName,
        })
        .from(cities)
        .innerJoin(states, eq(states.id, cities.stateId))
        .where(
          and(
            eq(cities.active, true),
            stateId ? eq(cities.stateId, stateId) : undefined,
            match,
            afterCursor(cities.normalisedName, cities.id, cursor),
          ),
        )
        .orderBy(asc(cities.normalisedName), asc(cities.id))
        .limit(limit + 1);
      const page = cursorPage(rows, limit, nameCursorKey);
      return {
        items: page.items.map(({ id, stateId: sid, name, active, stateName }) => ({
          id,
          stateId: sid,
          name,
          active,
          stateName,
        })),
        nextCursor: page.nextCursor,
      };
    },
  );
}

/**
 * One city, active or not. A deactivated city leaves the dropdowns but stays readable here, so an
 * address, hub or trade that holds its id still shows it.
 */
export async function getCity(db: Db, cache: GeoCache, cityId: string): Promise<CityWithState> {
  return cache.remember(`city:${cityId}`, async () => {
    const [row] = await citiesByIds(db, [cityId]);
    if (!row) throw cityNotFound();
    return row;
  });
}

/**
 * For other modules (addresses, hubs, trades): cities by id, inactive ones included. Not cached:
 * callers hold a handful of ids and want the truth.
 */
export async function citiesByIds(db: Db, ids: readonly string[]): Promise<CityWithState[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: cities.id,
      stateId: cities.stateId,
      name: cities.name,
      active: cities.active,
      stateName: states.name,
    })
    .from(cities)
    .innerJoin(states, eq(states.id, cities.stateId))
    .where(inArray(cities.id, [...ids]));
}
