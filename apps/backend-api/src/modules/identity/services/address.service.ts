// T-042. A buyer's saved delivery addresses.
//
// EVERY WRITE FOR ONE USER RUNS BEHIND ONE ADVISORY LOCK. Counting toward the cap, "the first address
// becomes the default" and "exactly one default" are all read-then-write rules, and two taps on a bad
// connection would otherwise both read "nineteen" or both read "no default". The lock is per user, so
// one person's burst never queues another's; `user_addresses_one_default` is the backstop if a caller
// ever skips it.
//
// Another user's address id is a 404 and never a 403: a 403 would confirm the row exists, which turns
// a uuid the client controls into a cross-account existence oracle (the same rule the device list
// keeps).
//
// PII. The phone, the street, the landmark and the recipient's name are written to the row and read
// back to its owner, and go nowhere else: events carry ids and the NAMES of the fields an edit touched,
// audit metadata the same, and nothing here logs a field.
import {
  MAX_ADDRESSES_PER_USER,
  type Address,
  type CreateAddressBody,
  type Paginated,
  type UpdateAddressBody,
} from '@komtru/shared-types';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { ApiError } from '../../../platform/errors.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { normalisePhone } from '../../../platform/identifiers.js';
import { getCitiesByIds } from '../../geo/index.js';
import {
  ADDRESS_FIELDS,
  identityAddressAddedEvent,
  identityAddressArchivedEvent,
  identityAddressDefaultChangedEvent,
  identityAddressUpdatedEvent,
} from '../domain/events.js';
import { userAddresses } from '../infrastructure/postgres/schema/addresses.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';

export type AddressView = Address;

/** What the audit row records about where the call came from. */
export interface AddressRequestContext {
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
}

type AddressRow = typeof userAddresses.$inferSelect;
type CityInfo = Awaited<ReturnType<typeof getCitiesByIds>>[number];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const invalidField = (path: string, message: string): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'That address cannot be saved', message, [{ path, message }]);

export const addressNotFound = (): ApiError =>
  new ApiError(404, 'NOT_FOUND', 'That address is not on your account');

export const addressArchived = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'That address has been archived',
    'An archived address cannot be changed. Add a new one instead.',
  );

export const addressLimitReached = (): ApiError =>
  new ApiError(
    409,
    'ADDRESS_LIMIT_REACHED',
    'You have saved as many addresses as one account can keep',
    `Archive one of your ${MAX_ADDRESSES_PER_USER} addresses before adding another`,
  );

const invalidCursor = (): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'Invalid cursor', 'Use the nextCursor from the previous page');

// ---------------------------------------------------------------------------
// Pieces shared by the writes
// ---------------------------------------------------------------------------

/** Serialises one user's address writes for the length of the transaction. */
const lockUser = (tx: Tx, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`identity.address:${userId}`}, 0))`);

const toE164 = (raw: string): string => {
  const phone = normalisePhone(raw);
  if (!phone) throw invalidField('recipientPhone', 'Enter a phone number we can call');
  return phone.phoneE164;
};

/**
 * The city must exist, belong to the chosen state and still be active. The state needs no lookup of
 * its own: a city that belongs to it proves it exists, and a state id that is nobody's fails the same
 * comparison.
 */
async function assertDeliverable(db: Db | Tx, stateId: string, cityId: string): Promise<void> {
  const [city] = await getCitiesByIds(db, [cityId]);
  if (!city) throw invalidField('cityId', 'Choose a city from the list');
  if (city.stateId !== stateId) throw invalidField('cityId', 'That city is not in the state you chose');
  if (!city.active) throw invalidField('cityId', 'We cannot deliver to that city yet');
}

const toView = (row: AddressRow, city: CityInfo | undefined): AddressView => ({
  id: row.id,
  label: row.label,
  recipientName: row.recipientName,
  recipientPhone: row.recipientPhone,
  streetLine: row.streetLine,
  landmark: row.landmark,
  stateId: row.stateId,
  // A city the catalog cannot resolve cannot happen (cities are never deleted); the empty names keep
  // the view total rather than throw on a read.
  stateName: city?.stateName ?? '',
  cityId: row.cityId,
  cityName: city?.name ?? '',
  cityActive: city?.active ?? false,
  isDefault: row.isDefault,
  archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

async function views(db: Db, rows: AddressRow[]): Promise<AddressView[]> {
  const found = await getCitiesByIds(db, [...new Set(rows.map((row) => row.cityId))]);
  const byId = new Map(found.map((city) => [city.id, city]));
  return rows.map((row) => toView(row, byId.get(row.cityId)));
}

async function viewOne(db: Db, row: AddressRow): Promise<AddressView> {
  const [view] = await views(db, [row]);
  if (!view) throw new Error('identity: an address row produced no view');
  return view;
}

/** The caller's own address, locked for the rest of the transaction. A miss is a 404. */
async function ownAddress(tx: Tx, userId: string, addressId: string): Promise<AddressRow> {
  const [row] = await tx
    .select()
    .from(userAddresses)
    .where(and(eq(userAddresses.id, addressId), eq(userAddresses.userId, userId)))
    .for('update');
  if (!row) throw addressNotFound();
  return row;
}

const consumer = (userId: string) => ({ type: 'CONSUMER' as const, id: userId });

const audit = (
  tx: Tx,
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  userId: string,
  request: AddressRequestContext,
  metadata: Record<string, unknown>,
) =>
  writeAudit(tx, {
    action,
    outcome: 'SUCCESS',
    actorType: 'USER',
    actorUserId: userId,
    subjectUserId: userId,
    ip: request.ip,
    userAgent: request.userAgent,
    sessionId: request.sessionId,
    metadata,
  });

const announceDefault = (tx: Tx, userId: string, addressId: string, previousAddressId: string | null) =>
  publish(tx, identityAddressDefaultChangedEvent, {
    payload: { userId, addressId, previousAddressId },
    aggregateType: 'identity.address',
    aggregateId: addressId,
    actor: consumer(userId),
  });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListAddressesInput {
  userId: string;
  limit: number;
  cursor?: CursorKey | undefined;
}

interface AddressCursor {
  isDefault: boolean;
  at: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readCursor(cursor: CursorKey | undefined): AddressCursor | undefined {
  if (cursor === undefined) return undefined;
  const { d, t, id } = cursor;
  if (
    (d !== 0 && d !== 1) ||
    typeof t !== 'string' ||
    Number.isNaN(Date.parse(t)) ||
    typeof id !== 'string' ||
    !UUID.test(id)
  ) {
    throw invalidCursor();
  }
  return { isDefault: d === 1, at: t, id };
}

/** `created_at` at full microsecond precision, as ISO text: a JS Date would round it and skip a row. */
const createdKey = sql<string>`to_char(${userAddresses.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The caller's live addresses: the default first, then newest first. Archived addresses are not
 * listed; they exist for the trades that snapshotted them.
 */
export async function listAddresses(db: Db, input: ListAddressesInput): Promise<Paginated<AddressView>> {
  const after = readCursor(input.cursor);
  const keyset: SQL | undefined = after
    ? sql`(${userAddresses.isDefault}, ${userAddresses.createdAt}, ${userAddresses.id}) < (${after.isDefault}::boolean, ${after.at}::timestamptz, ${after.id}::uuid)`
    : undefined;

  const rows = await db
    .select({ row: userAddresses, key: createdKey })
    .from(userAddresses)
    .where(and(eq(userAddresses.userId, input.userId), isNull(userAddresses.archivedAt), keyset))
    .orderBy(desc(userAddresses.isDefault), desc(userAddresses.createdAt), desc(userAddresses.id))
    .limit(input.limit + 1);

  const page = cursorPage(rows, input.limit, ({ row, key }) => ({
    d: row.isDefault ? 1 : 0,
    t: key,
    id: row.id,
  }));
  return {
    items: await views(
      db,
      page.items.map(({ row }) => row),
    ),
    nextCursor: page.nextCursor,
  };
}

/**
 * The trade gates' question (T-061): can this user be asked to ship to, or receive at, a saved
 * address? True when they hold a live address whose city is still in the catalog's active set; a
 * city staff deactivated is a place Komtru no longer serves, so the address cannot take a new trade.
 */
export async function hasUsableAddress(db: Db | Tx, userId: string): Promise<boolean> {
  const held = await db
    .selectDistinct({ cityId: userAddresses.cityId })
    .from(userAddresses)
    .where(and(eq(userAddresses.userId, userId), isNull(userAddresses.archivedAt)));
  if (held.length === 0) return false;
  const found = await getCitiesByIds(
    db,
    held.map((row) => row.cityId),
  );
  return found.some((city) => city.active);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateAddressInput {
  userId: string;
  body: CreateAddressBody;
  request: AddressRequestContext;
}

export async function createAddress(db: Db, input: CreateAddressInput): Promise<AddressView> {
  const { userId, body, request } = input;
  const phone = toE164(body.recipientPhone);
  await assertDeliverable(db, body.stateId, body.cityId);

  const row = await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const live = await tx
      .select({ id: userAddresses.id, isDefault: userAddresses.isDefault })
      .from(userAddresses)
      .where(and(eq(userAddresses.userId, userId), isNull(userAddresses.archivedAt)));
    if (live.length >= MAX_ADDRESSES_PER_USER) throw addressLimitReached();

    const current = live.find((address) => address.isDefault);
    const makeDefault = body.makeDefault === true || current === undefined;
    // Cleared first: the unique index is checked per statement, so the old default must lose the flag
    // before the new one takes it.
    if (makeDefault && current) {
      await tx
        .update(userAddresses)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(eq(userAddresses.id, current.id));
    }

    const [created] = await tx
      .insert(userAddresses)
      .values({
        userId,
        label: body.label,
        recipientName: body.recipientName,
        recipientPhone: phone,
        streetLine: body.streetLine,
        landmark: body.landmark,
        stateId: body.stateId,
        cityId: body.cityId,
        isDefault: makeDefault,
      })
      .returning();
    if (!created) throw new Error('identity: the address insert returned no row');

    await publish(tx, identityAddressAddedEvent, {
      payload: { userId, addressId: created.id, isDefault: makeDefault },
      aggregateType: 'identity.address',
      aggregateId: created.id,
      actor: consumer(userId),
    });
    if (makeDefault && current) await announceDefault(tx, userId, created.id, current.id);
    await audit(tx, AUDIT_ACTIONS.ADDRESS_ADDED, userId, request, {
      addressId: created.id,
      isDefault: makeDefault,
    });
    return created;
  });

  return viewOne(db, row);
}

export interface UpdateAddressInput {
  userId: string;
  addressId: string;
  body: UpdateAddressBody;
  request: AddressRequestContext;
}

export async function updateAddress(db: Db, input: UpdateAddressInput): Promise<AddressView> {
  const { userId, addressId, body, request } = input;
  const phone = body.recipientPhone === undefined ? undefined : toE164(body.recipientPhone);

  const row = await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await ownAddress(tx, userId, addressId);
    if (existing.archivedAt) throw addressArchived();

    // Only an edit that moves the state or the city is checked against the catalog, against the half it
    // did not move: a label change must not fail because staff deactivated the city since.
    if (body.stateId !== undefined || body.cityId !== undefined) {
      await assertDeliverable(tx, body.stateId ?? existing.stateId, body.cityId ?? existing.cityId);
    }

    const changed = ADDRESS_FIELDS.filter((field) => body[field] !== undefined);
    const [updated] = await tx
      .update(userAddresses)
      .set({
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.recipientName !== undefined ? { recipientName: body.recipientName } : {}),
        ...(phone !== undefined ? { recipientPhone: phone } : {}),
        ...(body.streetLine !== undefined ? { streetLine: body.streetLine } : {}),
        ...(body.landmark !== undefined ? { landmark: body.landmark } : {}),
        ...(body.stateId !== undefined ? { stateId: body.stateId } : {}),
        ...(body.cityId !== undefined ? { cityId: body.cityId } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(userAddresses.id, addressId))
      .returning();
    if (!updated) throw new Error('identity: the address update returned no row');

    await publish(tx, identityAddressUpdatedEvent, {
      payload: { userId, addressId, changed },
      aggregateType: 'identity.address',
      aggregateId: addressId,
      actor: consumer(userId),
    });
    await audit(tx, AUDIT_ACTIONS.ADDRESS_UPDATED, userId, request, { addressId, changed });
    return updated;
  });

  return viewOne(db, row);
}

export interface AddressTarget {
  userId: string;
  addressId: string;
  request: AddressRequestContext;
}

/**
 * Archives an address. Archiving the default promotes the newest remaining live address, so an
 * account that still has addresses always has a default; with none left there is no default, and the
 * next one added takes it. Archiving twice is a no-op, not an error: the client's retry is harmless.
 */
export async function archiveAddress(db: Db, input: AddressTarget): Promise<AddressView> {
  const { userId, addressId, request } = input;

  const row = await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await ownAddress(tx, userId, addressId);
    if (existing.archivedAt) return existing;

    const [archived] = await tx
      .update(userAddresses)
      .set({ archivedAt: sql`now()`, isDefault: false, updatedAt: sql`now()` })
      .where(eq(userAddresses.id, addressId))
      .returning();
    if (!archived) throw new Error('identity: the address archive returned no row');

    let promoted: string | null = null;
    if (existing.isDefault) {
      const [next] = await tx
        .select({ id: userAddresses.id })
        .from(userAddresses)
        .where(and(eq(userAddresses.userId, userId), isNull(userAddresses.archivedAt)))
        .orderBy(desc(userAddresses.createdAt), desc(userAddresses.id))
        .limit(1);
      if (next) {
        await tx
          .update(userAddresses)
          .set({ isDefault: true, updatedAt: sql`now()` })
          .where(eq(userAddresses.id, next.id));
        promoted = next.id;
      }
    }

    await publish(tx, identityAddressArchivedEvent, {
      payload: { userId, addressId },
      aggregateType: 'identity.address',
      aggregateId: addressId,
      actor: consumer(userId),
    });
    if (promoted) await announceDefault(tx, userId, promoted, addressId);
    await audit(tx, AUDIT_ACTIONS.ADDRESS_ARCHIVED, userId, request, {
      addressId,
      wasDefault: existing.isDefault,
      promotedAddressId: promoted,
    });
    return archived;
  });

  return viewOne(db, row);
}

/** Makes an address the default. Already the default is a no-op. An archived address cannot be. */
export async function makeDefaultAddress(db: Db, input: AddressTarget): Promise<AddressView> {
  const { userId, addressId, request } = input;

  const row = await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await ownAddress(tx, userId, addressId);
    if (existing.archivedAt) throw addressArchived();
    if (existing.isDefault) return existing;

    const [previous] = await tx
      .select({ id: userAddresses.id })
      .from(userAddresses)
      .where(and(eq(userAddresses.userId, userId), eq(userAddresses.isDefault, true)));
    if (previous) {
      await tx
        .update(userAddresses)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(eq(userAddresses.id, previous.id));
    }
    const [updated] = await tx
      .update(userAddresses)
      .set({ isDefault: true, updatedAt: sql`now()` })
      .where(eq(userAddresses.id, addressId))
      .returning();
    if (!updated) throw new Error('identity: the make-default update returned no row');

    await announceDefault(tx, userId, addressId, previous?.id ?? null);
    await audit(tx, AUDIT_ACTIONS.ADDRESS_DEFAULT_SET, userId, request, {
      addressId,
      previousAddressId: previous?.id ?? null,
    });
    return updated;
  });

  return viewOne(db, row);
}
