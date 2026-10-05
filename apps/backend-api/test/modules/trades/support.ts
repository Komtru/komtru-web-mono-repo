// Shared helpers for the trade schema's integration tests.
import type pg from 'pg';

export {
  sqlState,
  constraintName,
  errorMessage,
  insertUser,
} from '../identity/infrastructure/postgres/support.js';

/** Enum labels in declaration order, for the `trade` schema. */
export const enumLabels = async (owner: pg.Pool, name: string): Promise<string[]> => {
  const { rows } = await owner.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'trade' AND t.typname = $1
      ORDER BY e.enumsortorder`,
    [name],
  );
  return rows.map((row) => row.label);
};

/** Inserts a row from a plain column map, returning its id. Columns are named, values parameterised. */
export const insertRow = async (
  pool: pg.Pool,
  table: string,
  values: Record<string, unknown>,
): Promise<string> => {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING id`,
    Object.values(values),
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`insertRow(): ${table} returned no row`);
  return id;
};

let codeCounter = 0;
/** A distinct, well-formed trade code per call, so a test never collides by accident. */
export const testTradeCode = (): string => `KMT-${String(1_000_000 + ++codeCounter).padStart(7, '0')}-NG`;

export const ADDRESS = {
  street: '14 Adeola Odeku Street',
  landmark: 'Opposite Eko Hotel',
  recipient: 'Jane Doe',
  state_id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01',
  city_id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a02',
};

export interface TradeOverrides extends Record<string, unknown> {
  buyer_user_id?: string | null;
  seller_user_id?: string | null;
}

/** A DRAFT trade with the initiator on the buyer side unless the caller says otherwise. */
export const insertTrade = async (
  pool: pg.Pool,
  parties: { buyer?: string | null; seller?: string | null; initiator?: string; role?: 'BUYER' | 'SELLER' },
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const role = parties.role ?? 'BUYER';
  const initiator = parties.initiator ?? (role === 'BUYER' ? parties.buyer : parties.seller);
  return insertRow(pool, 'trade.trades', {
    trade_code: testTradeCode(),
    initiator_user_id: initiator,
    initiator_role: role,
    buyer_user_id: parties.buyer ?? null,
    seller_user_id: parties.seller ?? null,
    inspection_window_hours: 72,
    delivery_grace_hours: 48,
    ...overrides,
  });
};

/** The eight fee-snapshot columns, consistent with the database's arithmetic checks. */
export const feeSnapshotColumnValues = (
  itemMinor = 45_000_000n,
  feeMinor = 675_000n,
  commissionMinor = 0n,
) => ({
  fee_schedule_version: '2026-10-05.1',
  item_amount_minor: itemMinor.toString(),
  buyer_protection_fee_minor: feeMinor.toString(),
  buyer_total_minor: (itemMinor + feeMinor).toString(),
  commission_minor: commissionMinor.toString(),
  seller_payout_minor: (itemMinor - commissionMinor).toString(),
  fee_snapshot: JSON.stringify({ scheduleVersion: '2026-10-05.1' }),
  fees_snapshotted_at: new Date().toISOString(),
});
