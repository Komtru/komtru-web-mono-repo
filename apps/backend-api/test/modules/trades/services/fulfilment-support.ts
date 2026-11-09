/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- raw `pg` rows are untyped in assertions */
// Fixtures shared by the three T-064 integration tests: a funded trade whose accepted terms carry
// chosen cities, and a FulfilmentDeps whose other-module ports are fixtures.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { TradeStandard } from '../../../../src/modules/trades/services/ports.js';
import type { FulfilmentDeps } from '../../../../src/modules/trades/services/fulfilmentPorts.js';
import type { ApiError } from '../../../../src/platform/errors.js';
import type { TestDatabase } from '../../../support/db.js';
import { insertUser } from '../../identity/infrastructure/postgres/support.js';
import { ADDRESS, driveTo, insertTermsVersion, insertTrade } from '../support.js';

export const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected a rejection');
};

export const standard: TradeStandard = {
  versionId: randomUUID(),
  categoryId: randomUUID(),
  categoryCode: 'PHONES',
  categoryName: 'Phones',
  versionNumber: 3,
  createdAt: new Date(),
  inspectionWindowHours: 72,
  itemSpecFields: [],
  proofMedia: { minPhotos: 0, requireVideo: false },
  imeiVerification: false,
  deliveryDeadlineDays: 7,
};

export interface FakeWorld {
  cityNames: Map<string, string>;
  serviceable: Set<string>;
  companies: { id: string; name: string; isDefault: boolean }[];
  files: Map<
    string,
    { contentType: string; uploaderUserId: string; visibility: string; grantedUserIds: string[] }
  >;
  clock: { now: Date };
}

export const newWorld = (): FakeWorld => ({
  cityNames: new Map(),
  serviceable: new Set(),
  companies: [],
  files: new Map(),
  clock: { now: new Date() },
});

export const fulfilmentDeps = (t: TestDatabase, world: FakeWorld): FulfilmentDeps => ({
  db: t.db(),
  cities: (_db, ids) =>
    Promise.resolve(
      ids.map((id) => ({
        id,
        name: world.cityNames.get(id) ?? id,
        stateId: ADDRESS.state_id,
        stateName: 'X',
        active: true,
      })),
    ),
  proofFiles: (_tx, ids) =>
    Promise.resolve(
      ids.flatMap((id) => {
        const f = world.files.get(id);
        return f ? [{ id, ...f }] : [];
      }),
    ),
  standards: { current: () => Promise.resolve(standard), pinned: () => Promise.resolve(standard) },
  logistics: { enabledCompanies: () => Promise.resolve(world.companies) },
  park: {
    serviceableCityIds: (_tx, ids) => Promise.resolve(new Set(ids.filter((id) => world.serviceable.has(id)))),
  },
  now: () => world.clock.now,
});

export const person = (t: TestDatabase) => insertUser(t.owner(), { status: 'ACTIVE' });

export interface TradeFixture {
  tradeId: string;
  buyer: string;
  seller: string;
}

/** A trade driven to `status` with the given cities on its accepted terms, funded just now. */
export async function tradeAt(
  t: TestDatabase,
  status: string,
  options: { deliveryCity?: string; shipsFromCity?: string; overrides?: Record<string, unknown> } = {},
): Promise<TradeFixture> {
  const buyer = await person(t);
  const seller = await person(t);
  const tradeId = await insertTrade(
    t.owner(),
    { buyer, seller, role: 'SELLER' },
    {
      category_id: standard.categoryId,
      trade_standard_version: standard.versionNumber,
      ...options.overrides,
    },
  );
  await insertTermsVersion(t.owner(), tradeId, seller, {
    proposed_by_role: 'SELLER',
    delivery_address: JSON.stringify({ ...ADDRESS, city_id: options.deliveryCity ?? ADDRESS.city_id }),
    ships_from_address: JSON.stringify({ ...ADDRESS, city_id: options.shipsFromCity ?? ADDRESS.city_id }),
  });
  await driveTo(t.owner(), tradeId, status);
  if (status !== 'PENDING_PAYMENT') {
    await t.owner().query(`UPDATE trade.trades SET funded_at = now() WHERE id = $1`, [tradeId]);
  }
  return { tradeId, buyer, seller };
}

export const statusOf = async (pool: pg.Pool, tradeId: string): Promise<string> =>
  (await pool.query(`SELECT status FROM trade.trades WHERE id = $1`, [tradeId])).rows[0].status;

export const outboxOf = async (pool: pg.Pool, tradeId: string, eventType: string) =>
  (
    await pool.query(
      `SELECT payload FROM platform.outbox WHERE aggregate_id = $1 AND event_type = $2 ORDER BY seq`,
      [tradeId, eventType],
    )
  ).rows.map((row) => row.payload as Record<string, unknown>);
