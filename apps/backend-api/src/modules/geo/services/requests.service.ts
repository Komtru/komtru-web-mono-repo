// "My city isn't listed" (T-046). A user submits a state and the name they typed; staff add it as a new
// city, merge it into an existing one, or reject it with a reason; the requester is told either way.
//
// DECISIONS COVER THE GROUP. Fifty people typing "Jos East" are fifty rows, and staff should decide
// them once. Deciding a request decides every still-pending request for the same state and
// normalised name in the same transaction, locked in id order so two reviewers working the same
// group cannot deadlock, and publishes one `geo.city_request.decided` per requester.
import { normaliseCityName, type CityRequestStatus, type Paginated } from '@komtru/shared-types';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { ApiError } from '../../../platform/errors.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { MAX_ALIASES, cleanAliases, readTimeCursor } from '../domain/catalog.js';
import {
  cityExists,
  cityNotFound,
  cityRequestNotFound,
  MAX_PENDING_REQUESTS_PER_USER,
  mergeAliasClash,
  mergeTargetInvalid,
  requestLimitReached,
  requestAlreadyDecided,
  stateNotFound,
} from '../domain/errors.js';
import { catalogChanged, cityRequestDecided } from '../domain/events.js';
import { cities } from '../infrastructure/postgres/schema/cities.js';
import { cityRequests } from '../infrastructure/postgres/schema/city-requests.js';
import { states } from '../infrastructure/postgres/schema/states.js';
import { GEO_AUDIT, staffActorEvent, writeGeoAudit, type GeoActor } from './audit.js';
import { assertAliasesFree, insertCity } from './admin.service.js';

type RequestRow = typeof cityRequests.$inferSelect;

export interface CityRequestView {
  id: string;
  stateId: string;
  cityName: string;
  status: CityRequestStatus;
  resolvedCityId: string | null;
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const toView = (row: RequestRow): CityRequestView => ({
  id: row.id,
  stateId: row.stateId,
  cityName: row.cityName,
  status: row.status as CityRequestStatus,
  resolvedCityId: row.resolvedCityId,
  decisionReason: row.decisionReason,
  createdAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
});

/**
 * Records a request. A name that already matches an active city in the state (by name or alias) is a
 * 409 carrying that city's id, so the form selects it. Submitting the same thing twice returns the
 * request already pending rather than a second row.
 */
export async function submitCityRequest(
  db: Db,
  input: { userId: string; stateId: string; cityName: string },
): Promise<CityRequestView> {
  const normalisedName = normaliseCityName(input.cityName);
  const [state] = await db.select({ id: states.id }).from(states).where(eq(states.id, input.stateId));
  if (!state) throw stateNotFound();

  const [listed] = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(
      and(
        eq(cities.stateId, input.stateId),
        eq(cities.active, true),
        sql`(${cities.normalisedName} = ${normalisedName} OR ${normalisedName} = ANY(${cities.aliases}))`,
      ),
    );
  if (listed) throw cityExists(listed.id, listed.name, true);

  const pending = () =>
    db
      .select()
      .from(cityRequests)
      .where(
        and(
          eq(cityRequests.requestedByUserId, input.userId),
          eq(cityRequests.stateId, input.stateId),
          eq(cityRequests.normalisedName, normalisedName),
          eq(cityRequests.status, 'PENDING'),
        ),
      );

  const [already] = await pending();
  if (already) return toView(already);

  try {
    const row = await db.transaction(async (tx) => {
      // One user's submissions are counted and inserted one at a time, so two taps cannot both
      // slip under the cap.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`geo.city_request:${input.userId}`}, 0))`,
      );
      const [held] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(cityRequests)
        .where(and(eq(cityRequests.requestedByUserId, input.userId), eq(cityRequests.status, 'PENDING')));
      if ((held?.n ?? 0) >= MAX_PENDING_REQUESTS_PER_USER) throw requestLimitReached();
      const [inserted] = await tx
        .insert(cityRequests)
        .values({
          requestedByUserId: input.userId,
          stateId: input.stateId,
          cityName: input.cityName,
          normalisedName,
        })
        .returning();
      if (!inserted) throw new Error('geo: the city request insert returned no row');
      return inserted;
    });
    return toView(row);
  } catch (error) {
    // A double tap raced past the check above; the partial unique index made it one request.
    if (!isUniqueViolation(error, 'city_requests_pending_per_user')) throw error;
    const [winner] = await pending();
    if (!winner) throw error;
    return toView(winner);
  }
}

export interface AdminCityRequestView extends CityRequestView {
  requestedByUserId: string;
  stateName: string;
  /** Pending requests for this state and name, this one included: how many people want it. */
  requesterCount: number;
}

export interface RequestPageInput {
  limit: number;
  cursor?: CursorKey | undefined;
  status?: CityRequestStatus | undefined;
  stateId?: string | undefined;
}

/** Oldest first, so the queue is worked in the order people asked. */
export async function listCityRequests(
  db: Db,
  { limit, cursor, status, stateId }: RequestPageInput,
): Promise<Paginated<AdminCityRequestView>> {
  const position = readTimeCursor(cursor);
  const after = position
    ? sql`(${cityRequests.createdAt}, ${cityRequests.id}) > (${position.at}::timestamptz, ${position.id}::uuid)`
    : undefined;
  const rows = await db
    .select({
      row: cityRequests,
      stateName: states.name,
      // Microsecond text, because a JS Date would truncate to milliseconds and the keyset
      // comparison would then return the cursor's own row again on the next page.
      createdAtKey: sql<string>`to_char(${cityRequests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      requesterCount: sql<number>`(SELECT count(*)::int FROM ${cityRequests} AS g
          WHERE g.state_id = ${cityRequests.stateId} AND g.normalised_name = ${cityRequests.normalisedName} AND g.status = 'PENDING')`,
    })
    .from(cityRequests)
    .innerJoin(states, eq(states.id, cityRequests.stateId))
    .where(
      and(
        status ? eq(cityRequests.status, status) : undefined,
        stateId ? eq(cityRequests.stateId, stateId) : undefined,
        after,
      ),
    )
    .orderBy(asc(cityRequests.createdAt), asc(cityRequests.id))
    .limit(limit + 1);
  const page = cursorPage(rows, limit, ({ row, createdAtKey }) => ({ t: createdAtKey, id: row.id }));
  return {
    items: page.items.map(({ row, stateName, requesterCount }) => ({
      ...toView(row),
      requestedByUserId: row.requestedByUserId,
      stateName,
      requesterCount,
    })),
    nextCursor: page.nextCursor,
  };
}

export interface Group {
  target: RequestRow;
  /** Every still-pending request for the target's state and name, target included. */
  members: RequestRow[];
  stateName: string;
}

/** Locks the whole pending group in id order, then proves the target is still in it. */
export async function lockGroup(tx: Tx, requestId: string): Promise<Group> {
  const [probe] = await tx
    .select({ stateId: cityRequests.stateId, normalisedName: cityRequests.normalisedName })
    .from(cityRequests)
    .where(eq(cityRequests.id, requestId));
  if (!probe) throw cityRequestNotFound();
  const members = await tx
    .select()
    .from(cityRequests)
    .where(
      and(
        eq(cityRequests.stateId, probe.stateId),
        eq(cityRequests.normalisedName, probe.normalisedName),
        eq(cityRequests.status, 'PENDING'),
      ),
    )
    .orderBy(asc(cityRequests.id))
    .for('update');
  const target = members.find((member) => member.id === requestId);
  if (!target) throw requestAlreadyDecided();
  const [state] = await tx.select({ name: states.name }).from(states).where(eq(states.id, probe.stateId));
  if (!state) throw stateNotFound();
  return { target, members, stateName: state.name };
}

export interface Decision {
  actor: GeoActor;
  status: 'ADDED' | 'MERGED' | 'REJECTED';
  city: { id: string; name: string } | null;
  reason: string | null;
}

export async function applyDecision(
  tx: Tx,
  group: Group,
  decision: Decision,
  extraAudit: Record<string, unknown> = {},
): Promise<void> {
  const decidedAt = new Date();
  await tx
    .update(cityRequests)
    .set({
      status: decision.status,
      resolvedCityId: decision.city?.id ?? null,
      decidedByAdminId: decision.actor.userId,
      decisionReason: decision.reason,
      decidedAt,
    })
    // Exactly the rows that were locked (and so are notified and audited below). A request inserted
    // after the lock is not among them and stays PENDING for the next decision.
    .where(
      and(
        inArray(
          cityRequests.id,
          group.members.map((member) => member.id),
        ),
        eq(cityRequests.status, 'PENDING'),
      ),
    );

  const action = {
    ADDED: GEO_AUDIT.REQUEST_ADDED,
    MERGED: GEO_AUDIT.REQUEST_MERGED,
    REJECTED: GEO_AUDIT.REQUEST_REJECTED,
  }[decision.status];
  await writeGeoAudit(tx, decision.actor, action, {
    requestId: group.target.id,
    requestIds: group.members.map((member) => member.id),
    stateId: group.target.stateId,
    requestedName: group.target.cityName,
    cityId: decision.city?.id ?? null,
    reason: decision.reason,
    ...extraAudit,
  });

  for (const member of group.members) {
    await publish(tx, cityRequestDecided, {
      payload: {
        requestId: member.id,
        requesterUserId: member.requestedByUserId,
        status: decision.status,
        stateId: member.stateId,
        stateName: group.stateName,
        requestedName: member.cityName,
        cityId: decision.city?.id ?? null,
        cityName: decision.city?.name ?? null,
        reason: decision.reason,
      },
      aggregateType: 'geo.city_request',
      aggregateId: member.id,
      actor: staffActorEvent(decision.actor),
    });
  }
}

const reload = async (tx: Tx, id: string): Promise<CityRequestView> => {
  const [row] = await tx.select().from(cityRequests).where(eq(cityRequests.id, id));
  if (!row) throw cityRequestNotFound();
  return toView(row);
};

export interface AddRequestedCityInput {
  actor: GeoActor;
  requestId: string;
  /** Staff may fix the spelling; defaults to what the first requester typed. */
  name?: string | undefined;
  aliases?: readonly string[] | undefined;
  reason?: string | undefined;
}

/** Adds the requested city to the catalog and settles every pending request for it. */
export async function addRequestedCity(db: Db, input: AddRequestedCityInput): Promise<CityRequestView> {
  const [probe] = await db
    .select({ stateId: cityRequests.stateId, cityName: cityRequests.cityName })
    .from(cityRequests)
    .where(eq(cityRequests.id, input.requestId));
  if (!probe) throw cityRequestNotFound();
  const name = input.name ?? probe.cityName;

  try {
    return await db.transaction(async (tx) => {
      const group = await lockGroup(tx, input.requestId);
      // When staff corrected the spelling, keep what people typed searchable, as a merge does, unless
      // that would push the city past the alias cap.
      let aliases = input.aliases;
      if (normaliseCityName(name) !== group.target.normalisedName) {
        const withTyped = cleanAliases(
          [...(input.aliases ?? []), group.target.normalisedName],
          normaliseCityName(name),
        );
        if (withTyped.length <= MAX_ALIASES) aliases = withTyped;
      }
      const city = await insertCity(tx, input.actor, {
        stateId: group.target.stateId,
        name,
        aliases,
        reason: input.reason ?? null,
        via: 'CITY_REQUEST',
      });
      await applyDecision(tx, group, {
        actor: input.actor,
        status: 'ADDED',
        city: { id: city.id, name: city.name },
        reason: input.reason ?? null,
      });
      return reload(tx, input.requestId);
    });
  } catch (error) {
    if (!isUniqueViolation(error, 'cities_state_normalised_name_unique')) throw error;
    const [winner] = await db
      .select({ id: cities.id, name: cities.name, active: cities.active })
      .from(cities)
      .where(and(eq(cities.stateId, probe.stateId), eq(cities.normalisedName, normaliseCityName(name))));
    if (!winner) throw error;
    throw cityExists(winner.id, winner.name, winner.active);
  }
}

export interface MergeRequestInput {
  actor: GeoActor;
  requestId: string;
  cityId: string;
  /** Keep the typed name as a search alias of the target. Default true. */
  addAlias?: boolean | undefined;
  reason?: string | undefined;
}

/** Folds the request into an existing active city of the same state and settles the group. */
export async function mergeRequest(db: Db, input: MergeRequestInput): Promise<CityRequestView> {
  return db.transaction(async (tx) => {
    const group = await lockGroup(tx, input.requestId);
    const [target] = await tx.select().from(cities).where(eq(cities.id, input.cityId)).for('update');
    if (!target) throw cityNotFound();
    if (target.stateId !== group.target.stateId) {
      throw mergeTargetInvalid('That city is in a different state from the request');
    }
    if (!target.active) throw mergeTargetInvalid('That city is deactivated; reactivate it or pick another');

    let aliasSkipped: string | undefined;
    if (input.addAlias !== false) {
      const aliases = cleanAliases([...target.aliases, group.target.normalisedName], target.normalisedName);
      if (aliases.length > MAX_ALIASES) {
        // A city that already holds the most aliases it may is still a valid merge target; the
        // request is folded in without the alias, and the audit row says so.
        aliasSkipped = 'MAX_ALIASES';
      } else if (aliases.length !== target.aliases.length) {
        try {
          await assertAliasesFree(tx, target.stateId, aliases, target.id);
        } catch (error) {
          if (error instanceof ApiError && typeof error.extensions?.otherName === 'string') {
            throw mergeAliasClash(group.target.normalisedName, error.extensions.otherName);
          }
          throw error;
        }
        await tx.update(cities).set({ aliases, updatedAt: new Date() }).where(eq(cities.id, target.id));
        await writeGeoAudit(tx, input.actor, GEO_AUDIT.CITY_UPDATED, {
          cityId: target.id,
          stateId: target.stateId,
          oldName: target.name,
          newName: target.name,
          oldAliases: target.aliases,
          newAliases: aliases,
          reason: input.reason ?? null,
          via: 'CITY_REQUEST_MERGE',
        });
        await publish(tx, catalogChanged, {
          payload: { change: 'CITY_UPDATED', stateId: target.stateId, cityId: target.id },
          aggregateType: 'geo.city',
          aggregateId: target.id,
          actor: staffActorEvent(input.actor),
        });
      }
    }

    await applyDecision(
      tx,
      group,
      {
        actor: input.actor,
        status: 'MERGED',
        city: { id: target.id, name: target.name },
        reason: input.reason ?? null,
      },
      aliasSkipped ? { aliasSkipped } : {},
    );
    return reload(tx, input.requestId);
  });
}

export interface RejectRequestInput {
  actor: GeoActor;
  requestId: string;
  reason: string;
}

export async function rejectRequest(db: Db, input: RejectRequestInput): Promise<CityRequestView> {
  return db.transaction(async (tx) => {
    const group = await lockGroup(tx, input.requestId);
    await applyDecision(tx, group, {
      actor: input.actor,
      status: 'REJECTED',
      city: null,
      reason: input.reason,
    });
    return reload(tx, input.requestId);
  });
}
