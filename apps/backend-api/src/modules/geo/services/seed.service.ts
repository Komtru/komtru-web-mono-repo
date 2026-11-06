// Seeds the catalog from the reviewed list. Insert-only and idempotent: it runs on every deploy.
//
// A state is keyed on its code. A city is keyed on `seed_key`, which is stable across a rename, and
// the insert skips on ANY unique conflict, so:
//  - a city staff renamed is not added again under its old name,
//  - a city staff deactivated is not reactivated,
//  - a city staff added by hand before the list gained it is not duplicated,
//  - a name dropped from the list is not deleted.
import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { seedRows } from '../domain/seed.js';
import { cities } from '../infrastructure/postgres/schema/cities.js';
import { states } from '../infrastructure/postgres/schema/states.js';

// Two deploys seeding at once would interleave; the lock makes the second wait for the first.
const SEED_LOCK = 0x67656f31; // "geo1"

export async function seedLocations(db: Db): Promise<void> {
  const rows = seedRows();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_LOCK})`);
    await tx.insert(states).values(rows.states).onConflictDoNothing();
    const stateRows = await tx
      .select({ id: states.id, code: states.code })
      .from(states)
      .where(
        inArray(
          states.code,
          rows.states.map((s) => s.code),
        ),
      );
    const idByCode = new Map(stateRows.map((s) => [s.code, s.id]));
    await tx
      .insert(cities)
      .values(
        rows.cities.map((city) => {
          const stateId = idByCode.get(city.stateCode);
          if (!stateId) throw new Error(`geo: seed state ${city.stateCode} was not inserted`);
          return {
            stateId,
            name: city.name,
            normalisedName: city.normalisedName,
            aliases: city.aliases,
            seedKey: city.seedKey,
          };
        }),
      )
      .onConflictDoNothing();
  });
}
