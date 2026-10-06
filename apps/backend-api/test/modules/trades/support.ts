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

/** A DRAFT trade with the initiator on the buyer side unless the caller says otherwise. Every trade
 * starts at DRAFT — migration 0021 refuses any other starting status — so a fixture that needs a
 * later state walks there with `driveTo`. */
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

/**
 * A fee snapshot in the fee module's shape (T-047), as a fixture. The version is deliberately not a
 * real `config/fees.yaml` version: a fixture that copies one goes stale the first time a fee
 * changes, and nothing here depends on the value beyond its being text.
 */
export const testFeeSnapshot = (itemMinor = 45_000_000n, feeMinor = 675_000n, commissionMinor = 0n) => ({
  version: 'test-fee-schedule',
  currency: 'NGN' as const,
  takenAt: new Date().toISOString(),
  sellerKind: 'CASUAL' as const,
  amounts: {
    itemMinor: itemMinor.toString(),
    buyerProtectionFeeMinor: feeMinor.toString(),
    buyerTotalMinor: (itemMinor + feeMinor).toString(),
    commissionMinor: commissionMinor.toString(),
    sellerProceedsMinor: (itemMinor - commissionMinor).toString(),
    platformRevenueMinor: (feeMinor + commissionMinor).toString(),
  },
  terms: {
    buyerProtectionBps: 150,
    buyerProtectionMinMinor: '0',
    buyerProtectionMaxMinor: null,
    buyerProtectionRefundableOnFullRefund: true,
    commissionBps: 0,
    commissionMinMinor: '0',
    commissionMaxMinor: null,
  },
});

/** The nine fee-snapshot columns, consistent with the database's arithmetic checks. */
export const feeSnapshotColumnValues = (
  itemMinor = 45_000_000n,
  feeMinor = 675_000n,
  commissionMinor = 0n,
) => {
  const snapshot = testFeeSnapshot(itemMinor, feeMinor, commissionMinor);
  return {
    fee_schedule_version: snapshot.version,
    item_amount_minor: snapshot.amounts.itemMinor,
    buyer_protection_fee_minor: snapshot.amounts.buyerProtectionFeeMinor,
    buyer_total_minor: snapshot.amounts.buyerTotalMinor,
    commission_minor: snapshot.amounts.commissionMinor,
    seller_proceeds_minor: snapshot.amounts.sellerProceedsMinor,
    platform_revenue_minor: snapshot.amounts.platformRevenueMinor,
    fee_snapshot: JSON.stringify(snapshot),
    fees_snapshotted_at: snapshot.takenAt,
  };
};

export interface Step {
  action: string;
  to: string;
  /** The acceptance step writes the fee snapshot, without which PENDING_PAYMENT is rejected. */
  fees?: boolean;
}

const AFTER = (status: string, ...steps: Step[]): Step[] => [...(ROUTES[status] ?? []), ...steps];

/** The canonical route from DRAFT to each status, so a fixture reaches one the way a trade does. */
export const ROUTES: Record<string, Step[]> = {};
Object.assign(ROUTES, {
  DRAFT: [],
  AWAITING_ACCEPTANCE: [{ action: 'SEND', to: 'AWAITING_ACCEPTANCE' }],
  PENDING_COUNTERPARTY: [{ action: 'SEND', to: 'PENDING_COUNTERPARTY' }],
  UNDER_PROPOSAL_REVIEW: [{ action: 'SEND', to: 'UNDER_PROPOSAL_REVIEW' }],
});
Object.assign(ROUTES, {
  DECLINED: AFTER('AWAITING_ACCEPTANCE', { action: 'DECLINE', to: 'DECLINED' }),
  CANCELLED: AFTER('AWAITING_ACCEPTANCE', { action: 'CANCEL', to: 'CANCELLED' }),
  REJECTED: AFTER('UNDER_PROPOSAL_REVIEW', { action: 'REJECT_REVIEW', to: 'REJECTED' }),
  PENDING_PAYMENT: AFTER('AWAITING_ACCEPTANCE', { action: 'ACCEPT', to: 'PENDING_PAYMENT', fees: true }),
});
Object.assign(ROUTES, {
  EXPIRED: AFTER('PENDING_PAYMENT', { action: 'EXPIRE', to: 'EXPIRED' }),
  FUNDED: AFTER('PENDING_PAYMENT', { action: 'FUND', to: 'FUNDED' }),
});
Object.assign(ROUTES, {
  CANCELLED_REFUNDED: AFTER('FUNDED', { action: 'REFUND_CANCELLATION', to: 'CANCELLED_REFUNDED' }),
  SHIPPED: AFTER('FUNDED', { action: 'BEGIN_CUSTODY', to: 'SHIPPED' }),
});
Object.assign(ROUTES, {
  UNCONFIRMED_DELIVERY: AFTER('SHIPPED', { action: 'DELIVERY_SIGNAL', to: 'UNCONFIRMED_DELIVERY' }),
  DISPUTED: AFTER('SHIPPED', { action: 'DISPUTE', to: 'DISPUTED' }),
  INSPECTION: AFTER('SHIPPED', { action: 'DELIVERY_SIGNAL', to: 'INSPECTION' }),
});
Object.assign(ROUTES, {
  RESOLVED_REFUNDED: AFTER('DISPUTED', { action: 'RESOLVE_DISPUTE', to: 'RESOLVED_REFUNDED' }),
  RESOLVED_RELEASED: AFTER('DISPUTED', { action: 'RESOLVE_DISPUTE', to: 'RESOLVED_RELEASED' }),
  COMPLETED: AFTER('INSPECTION', { action: 'COMPLETE', to: 'COMPLETED' }),
});
Object.assign(ROUTES, { SETTLED: AFTER('COMPLETED', { action: 'SETTLE', to: 'SETTLED' }) });

/** A terms version for a trade, as the proposal flow will write it. Returns its id. */
export const insertTermsVersion = async (
  pool: pg.Pool,
  tradeId: string,
  proposedBy: string,
  overrides: Record<string, unknown> = {},
): Promise<string> =>
  insertRow(pool, 'trade.trade_terms_versions', {
    trade_id: tradeId,
    version_number: 1,
    proposed_by_user_id: proposedBy,
    proposed_by_role: 'BUYER',
    item_amount_minor: '45000000',
    item_spec: JSON.stringify({ brand: 'Apple', model: 'iPhone 15' }),
    inspection_window_hours: 72,
    delivery_grace_hours: 48,
    delivery_address: JSON.stringify(ADDRESS),
    ships_from_address: JSON.stringify(ADDRESS),
    ...overrides,
  });

/** One transition, as raw SQL: what a service does, with nothing of the service's help. */
export const transition = async (
  pool: pg.Pool,
  tradeId: string,
  step: Step & { actorType?: string; actorId?: string | null },
  extra: Record<string, unknown> = {},
): Promise<pg.QueryResult> => {
  const columns = { ...(step.fees ? feeSnapshotColumnValues() : {}), ...extra };
  const names = Object.keys(columns);
  const assignments = names.map((name, i) => `"${name}" = $${i + 5}`);
  return pool.query(
    `UPDATE trade.trades
        SET status = $2, status_action = $3, status_actor_type = $4,
            status_revision = status_revision + 1
            ${assignments.length ? `, ${assignments.join(', ')}` : ''}
      WHERE id = $1`,
    [tradeId, step.to, step.action, step.actorType ?? 'SYSTEM', ...Object.values(columns)],
  );
};

/** Walks a trade from DRAFT to `target` along the canonical route. */
export const driveTo = async (pool: pg.Pool, tradeId: string, target: string): Promise<void> => {
  const route = ROUTES[target];
  if (!route) throw new Error(`driveTo(): no route to ${target}`);
  for (const step of route) {
    // Acceptance pins the agreed terms as well as freezing the fees: the database requires both
    // before a trade can be paid for.
    const extra = step.fees ? { accepted_terms_version_id: await acceptedTermsFor(pool, tradeId) } : {};
    await transition(pool, tradeId, step, extra);
  }
};

/** The trade's own terms version, created on demand so a fixture need not think about it. */
const acceptedTermsFor = async (pool: pg.Pool, tradeId: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string; initiator: string }>(
    `SELECT v.id, t.initiator_user_id AS initiator
       FROM trade.trades t LEFT JOIN trade.trade_terms_versions v ON v.trade_id = t.id
      WHERE t.id = $1 ORDER BY v.version_number DESC LIMIT 1`,
    [tradeId],
  );
  const existing = rows[0];
  if (existing?.id) return existing.id;
  return insertTermsVersion(pool, tradeId, existing?.initiator ?? '');
};
