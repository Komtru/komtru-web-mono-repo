// The staff write path for cities (T-046): add, rename and re-alias, deactivate, reactivate. There is
// no delete, here or anywhere: a city that an address, a hub or a trade holds only ever goes
// inactive, and stays readable by id.
import { normaliseCityName, type Paginated } from '@komtru/shared-types';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { cleanAliases, nameCursorKey, readNameCursor } from '../domain/catalog.js';
import { aliasClash, cityExists, cityNotFound, nameIsAlias, stateNotFound } from '../domain/errors.js';
import { catalogChanged } from '../domain/events.js';
import { cities } from '../infrastructure/postgres/schema/cities.js';
import { states } from '../infrastructure/postgres/schema/states.js';
import { GEO_AUDIT, staffActorEvent, writeGeoAudit, type GeoActor } from './audit.js';

export interface AdminCityView {
  id: string;
  stateId: string;
  name: string;
  aliases: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminStateView {
  id: string;
  code: string;
  name: string;
  cityCount: number;
  activeCityCount: number;
}

type CityRow = typeof cities.$inferSelect;

const toView = (row: CityRow): AdminCityView => ({
  id: row.id,
  stateId: row.stateId,
  name: row.name,
  aliases: row.aliases,
  active: row.active,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

interface PageInput {
  limit: number;
  cursor?: CursorKey | undefined;
}

export async function listStatesAdmin(
  db: Db,
  { limit, cursor }: PageInput,
): Promise<Paginated<AdminStateView>> {
  const after = readNameCursor(cursor);
  const rows = await db
    .select({
      id: states.id,
      code: states.code,
      name: states.name,
      normalisedName: states.normalisedName,
      // Written out in full: drizzle renders a column inside a subquery unqualified, so
      // `cities.state_id = states.id` would compare the inner table's id with itself.
      cityCount: sql<number>`(SELECT count(*)::int FROM geo.cities c WHERE c.state_id = geo.states.id)`,
      activeCityCount: sql<number>`(SELECT count(*)::int FROM geo.cities c WHERE c.state_id = geo.states.id AND c.active)`,
    })
    .from(states)
    .where(
      after ? sql`(${states.normalisedName}, ${states.id}) > (${after.name}, ${after.id}::uuid)` : undefined,
    )
    .orderBy(asc(states.normalisedName), asc(states.id))
    .limit(limit + 1);
  const page = cursorPage(rows, limit, nameCursorKey);
  return {
    items: page.items.map(({ normalisedName: _unused, ...state }) => state),
    nextCursor: page.nextCursor,
  };
}

export async function listCitiesAdmin(
  db: Db,
  stateId: string,
  { limit, cursor, includeInactive }: PageInput & { includeInactive: boolean },
): Promise<Paginated<AdminCityView>> {
  const [state] = await db.select({ id: states.id }).from(states).where(eq(states.id, stateId));
  if (!state) throw stateNotFound();
  const after = readNameCursor(cursor);
  const rows = await db
    .select()
    .from(cities)
    .where(
      and(
        eq(cities.stateId, stateId),
        includeInactive ? undefined : eq(cities.active, true),
        after
          ? sql`(${cities.normalisedName}, ${cities.id}) > (${after.name}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(cities.normalisedName), asc(cities.id))
    .limit(limit + 1);
  const page = cursorPage(rows, limit, nameCursorKey);
  return { items: page.items.map(toView), nextCursor: page.nextCursor };
}

/** An alias that is another city's own name would make that city's typeahead ambiguous. */
export async function assertAliasesFree(
  tx: Tx,
  stateId: string,
  aliases: readonly string[],
  exceptCityId?: string,
): Promise<void> {
  if (aliases.length === 0) return;
  const [clash] = await tx
    .select({ name: cities.name, normalisedName: cities.normalisedName })
    .from(cities)
    .where(
      and(
        eq(cities.stateId, stateId),
        inArray(cities.normalisedName, [...aliases]),
        exceptCityId ? ne(cities.id, exceptCityId) : undefined,
      ),
    );
  if (clash) throw aliasClash(clash.normalisedName, clash.name);
}

/** A city's own name must not be another city's alias, or one typeahead prefix means two places. */
export async function assertNameNotAnAlias(
  tx: Tx,
  stateId: string,
  normalisedName: string,
  displayName: string,
  exceptCityId?: string,
): Promise<void> {
  const [other] = await tx
    .select({ name: cities.name })
    .from(cities)
    .where(
      and(
        eq(cities.stateId, stateId),
        sql`${normalisedName} = ANY(${cities.aliases})`,
        exceptCityId ? ne(cities.id, exceptCityId) : undefined,
      ),
    );
  if (other) throw nameIsAlias(displayName, other.name);
}

/**
 * Inserts a city inside the caller's transaction. Shared by "add a city" and "add a requested city",
 * so both enforce the same uniqueness and write the same audit row and event.
 */
export async function insertCity(
  tx: Tx,
  actor: GeoActor,
  input: {
    stateId: string;
    name: string;
    aliases?: readonly string[] | undefined;
    reason: string | null;
    via: string;
  },
): Promise<CityRow> {
  const [state] = await tx.select({ id: states.id }).from(states).where(eq(states.id, input.stateId));
  if (!state) throw stateNotFound();
  const normalisedName = normaliseCityName(input.name);
  const [existing] = await tx
    .select({ id: cities.id, name: cities.name, active: cities.active })
    .from(cities)
    .where(and(eq(cities.stateId, input.stateId), eq(cities.normalisedName, normalisedName)));
  if (existing) throw cityExists(existing.id, existing.name, existing.active);
  await assertNameNotAnAlias(tx, input.stateId, normalisedName, input.name);
  const aliases = cleanAliases(input.aliases, normalisedName);
  await assertAliasesFree(tx, input.stateId, aliases);

  const [row] = await tx
    .insert(cities)
    .values({ stateId: input.stateId, name: input.name, normalisedName, aliases })
    .returning();
  if (!row) throw new Error('geo: the city insert returned no row');

  await writeGeoAudit(tx, actor, GEO_AUDIT.CITY_ADDED, {
    cityId: row.id,
    stateId: row.stateId,
    name: row.name,
    aliases,
    via: input.via,
    reason: input.reason,
  });
  await publish(tx, catalogChanged, {
    payload: { change: 'CITY_ADDED', stateId: row.stateId, cityId: row.id },
    aggregateType: 'geo.city',
    aggregateId: row.id,
    actor: staffActorEvent(actor),
  });
  return row;
}

/**
 * A race on the unique index surfaces as a unique violation that aborts the transaction, so it is
 * translated outside it, with the winner looked up afterwards.
 */
async function translateDuplicate<T>(
  db: Db,
  stateId: string,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error, 'cities_state_normalised_name_unique')) throw error;
    const [winner] = await db
      .select({ id: cities.id, name: cities.name, active: cities.active })
      .from(cities)
      .where(and(eq(cities.stateId, stateId), eq(cities.normalisedName, normaliseCityName(name))));
    if (!winner) throw error;
    throw cityExists(winner.id, winner.name, winner.active);
  }
}

export interface AddCityInput {
  actor: GeoActor;
  stateId: string;
  name: string;
  aliases?: readonly string[] | undefined;
  reason: string;
}

export async function addCity(db: Db, input: AddCityInput): Promise<AdminCityView> {
  const row = await translateDuplicate(db, input.stateId, input.name, () =>
    db.transaction((tx) =>
      insertCity(tx, input.actor, {
        stateId: input.stateId,
        name: input.name,
        aliases: input.aliases,
        reason: input.reason,
        via: 'ADMIN',
      }),
    ),
  );
  return toView(row);
}

const lockCity = async (tx: Tx, cityId: string): Promise<CityRow> => {
  const [row] = await tx.select().from(cities).where(eq(cities.id, cityId)).for('update');
  if (!row) throw cityNotFound();
  return row;
};

export interface UpdateCityInput {
  actor: GeoActor;
  cityId: string;
  name?: string | undefined;
  /** Replaces the alias list when given. */
  aliases?: readonly string[] | undefined;
  reason: string;
}

/**
 * Renames and/or re-aliases. A rename that changes the normalised name keeps the old name as an
 * alias, so the typeahead still finds a city under what people used to call it. Changing only the
 * display spelling (capitalisation, accents, a hyphen) is allowed and collides with nothing.
 *
 * `changed` is false when nothing differs, in which case nothing is logged or published.
 */
export async function updateCity(
  db: Db,
  input: UpdateCityInput,
): Promise<{ city: AdminCityView; changed: boolean }> {
  const [before] = await db
    .select({ stateId: cities.stateId, name: cities.name })
    .from(cities)
    .where(eq(cities.id, input.cityId));
  if (!before) throw cityNotFound();
  const nameForRace = input.name ?? before.name;

  return translateDuplicate(db, before.stateId, nameForRace, () =>
    db.transaction(async (tx) => {
      const current = await lockCity(tx, input.cityId);
      const name = input.name ?? current.name;
      const normalisedName = normaliseCityName(name);

      if (normalisedName !== current.normalisedName) {
        const [clash] = await tx
          .select({ id: cities.id, name: cities.name, active: cities.active })
          .from(cities)
          .where(
            and(
              eq(cities.stateId, current.stateId),
              eq(cities.normalisedName, normalisedName),
              ne(cities.id, current.id),
            ),
          );
        if (clash) throw cityExists(clash.id, clash.name, clash.active);
        await assertNameNotAnAlias(tx, current.stateId, normalisedName, name, current.id);
      }

      const requested = input.aliases !== undefined ? [...input.aliases] : current.aliases;
      const withOld =
        normalisedName !== current.normalisedName ? [...requested, current.normalisedName] : requested;
      const aliases = cleanAliases(withOld, normalisedName);
      await assertAliasesFree(tx, current.stateId, aliases, current.id);

      const same =
        name === current.name &&
        aliases.length === current.aliases.length &&
        aliases.every((alias, i) => alias === current.aliases[i]);
      if (same) return { city: toView(current), changed: false };

      const [updated] = await tx
        .update(cities)
        .set({ name, normalisedName, aliases, updatedAt: new Date() })
        .where(eq(cities.id, current.id))
        .returning();
      if (!updated) throw new Error('geo: the city update returned no row');

      await writeGeoAudit(tx, input.actor, GEO_AUDIT.CITY_UPDATED, {
        cityId: current.id,
        stateId: current.stateId,
        oldName: current.name,
        newName: name,
        oldAliases: current.aliases,
        newAliases: aliases,
        reason: input.reason,
      });
      await publish(tx, catalogChanged, {
        payload: { change: 'CITY_UPDATED', stateId: current.stateId, cityId: current.id },
        aggregateType: 'geo.city',
        aggregateId: current.id,
        actor: staffActorEvent(input.actor),
      });
      return { city: toView(updated), changed: true };
    }),
  );
}

export interface SetActiveInput {
  actor: GeoActor;
  cityId: string;
  active: boolean;
  reason: string;
}

/** Deactivate or reactivate. Deactivating takes a city out of the dropdowns and nothing else. */
export async function setCityActive(
  db: Db,
  input: SetActiveInput,
): Promise<{ city: AdminCityView; changed: boolean }> {
  return db.transaction(async (tx) => {
    const current = await lockCity(tx, input.cityId);
    if (current.active === input.active) return { city: toView(current), changed: false };

    const [updated] = await tx
      .update(cities)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(cities.id, current.id))
      .returning();
    if (!updated) throw new Error('geo: the city update returned no row');

    await writeGeoAudit(
      tx,
      input.actor,
      input.active ? GEO_AUDIT.CITY_ACTIVATED : GEO_AUDIT.CITY_DEACTIVATED,
      { cityId: current.id, stateId: current.stateId, name: current.name, reason: input.reason },
    );
    await publish(tx, catalogChanged, {
      payload: {
        change: input.active ? 'CITY_ACTIVATED' : 'CITY_DEACTIVATED',
        stateId: current.stateId,
        cityId: current.id,
      },
      aggregateType: 'geo.city',
      aggregateId: current.id,
      actor: staffActorEvent(input.actor),
    });
    return { city: toView(updated), changed: true };
  });
}
