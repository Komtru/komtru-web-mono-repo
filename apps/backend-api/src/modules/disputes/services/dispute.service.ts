// Opening a dispute (M3 D1) and withdrawing one (SP-M23).
//
// D1's rule is that the two creation paths converge: a buyer filing from the trade workspace and a
// support agent escalating a ticket produce the same row, in the same state, with the same windows
// running. That is why there is ONE `openDispute` and `creationPath` is a parameter — the function
// never branches on it, and a reader can see at a glance that it cannot.
import { asc, desc, eq, sql } from 'drizzle-orm';
import { registerCase } from '../../cases/index.js';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { disputeClosed, disputeOpened } from '../domain/events.js';
import {
  disputeAlreadyOpen,
  disputeNotFound,
  notADisputeParty,
  onlyOpenerMayWithdraw,
  tradeNotDisputable,
} from '../domain/errors.js';
import { disputeCode, type DisputeCategory, type DisputeCreationPath } from '../domain/types.js';
import { evidenceDeadline, mediationDeadline } from '../domain/windows.js';
import { disputeCases } from '../infrastructure/postgres/schema/disputes.js';
import { disputeStatusChanges } from '../infrastructure/postgres/schema/statusChanges.js';
import { DISPUTABLE_TRADE_STATUSES, type DisputePorts } from './ports.js';
import { DISPUTE_AUDIT, lockDispute, moveCase, writeDisputeAudit, type DisputeActor } from './transition.js';
import { partyRole, toDisputeView, type DisputeView } from './views.js';

export interface OpenDisputeInput {
  tradeId: string;
  /** The person filing. On a ticket escalation this is still the party, not the agent. */
  openedByUserId: string;
  category: DisputeCategory;
  reason: string;
  creationPath: DisputeCreationPath;
  sourceTicketId?: string | null;
  actor: DisputeActor;
}

/**
 * Creates the case, starts both clocks, indexes it for staff and tells M7.
 *
 * The one-open-dispute-per-trade rule is the partial unique index's, not a read's. A check-then-
 * insert here would lose the race it exists to win: two parties filing in the same instant both
 * read "no dispute" and both insert. Instead the insert is attempted and a unique violation is
 * turned into the 409 the second caller should have got.
 */
export async function openDispute(
  ports: DisputePorts,
  tx: Tx,
  input: OpenDisputeInput,
): Promise<DisputeView> {
  const trade = await ports.tradeForDispute(tx, {
    tradeId: input.tradeId,
    userId: input.openedByUserId,
  });
  if (!trade) throw notADisputeParty();
  if (!DISPUTABLE_TRADE_STATUSES.includes(trade.status)) throw tradeNotDisputable(trade.status);

  const now = ports.now();
  const [mediationHours, evidenceDays] = await Promise.all([
    ports.mediationWindowHours(),
    ports.evidenceWindowDays(),
  ]);

  // Both windows are set at open time, from the same instant. The evidence window is therefore
  // already running behind the mediation one — deliberately: M3 D2 says the evidence window is the
  // same for both parties, and starting it when mediation lapses would make it depend on when a
  // sweep happened to fire.
  const row = await insertCase(tx, {
    tradeId: trade.tradeId,
    orderId: trade.orderId,
    sourceTicketId: input.sourceTicketId ?? null,
    buyerUserId: trade.buyerUserId,
    sellerUserId: trade.sellerUserId,
    openedByUserId: input.openedByUserId,
    category: input.category,
    creationPath: input.creationPath,
    openedReason: input.reason.trim(),
    totalEscrowMinor: trade.itemAmountMinor,
    mediationDeadlineAt: mediationDeadline(now, mediationHours),
    evidenceDeadlineAt: evidenceDeadline(now, evidenceDays),
  });

  // The opening row of the timeline. `moveCase` writes one for every later transition; this is the
  // only one it cannot, because a case is created in MEDIATION rather than moved into it, so
  // `fromStatus` is null.
  await tx.insert(disputeStatusChanges).values({
    disputeId: row.id,
    fromStatus: null,
    toStatus: row.status,
    action: 'OPEN',
    actorType: input.actor.actorType,
    actorId: input.actor.userId,
    reason: row.openedReason,
  });

  // T-107: the case index is how TrustOps sees there is work. Registered in this transaction, so a
  // dispute that exists is always a case staff can find.
  await registerCase(tx, {
    type: 'DISPUTE',
    subjectType: 'dispute',
    subjectId: row.id,
    title: `${disputeCode(row.disputeNumber)} · ${trade.tradeCode}`,
    facts: {
      tradeId: trade.tradeId,
      category: input.category,
      creationPath: input.creationPath,
      status: row.status,
      totalEscrowMinor: row.totalEscrowMinor.toString(),
    },
  });

  // M3 D1: a dispute never exists without a trade that is, or immediately becomes, DISPUTED.
  // Same transaction, so the two systems cannot disagree.
  await ports.moveTradeToDisputed(tx, { tradeId: trade.tradeId, actorUserId: input.openedByUserId });

  await writeDisputeAudit(tx, input.actor, DISPUTE_AUDIT.OPENED, {
    disputeId: row.id,
    tradeId: trade.tradeId,
    category: input.category,
    creationPath: input.creationPath,
  });

  await publish(tx, disputeOpened, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      category: row.category,
      creationPath: row.creationPath,
      openedByUserId: row.openedByUserId,
      buyerUserId: row.buyerUserId,
      sellerUserId: row.sellerUserId,
      sourceTicketId: row.sourceTicketId,
      totalEscrowMinor: row.totalEscrowMinor.toString(),
      mediationDeadlineAt: row.mediationDeadlineAt.toISOString(),
      evidenceDeadlineAt: row.evidenceDeadlineAt.toISOString(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return toDisputeView(row, now);
}

/**
 * The insert, with the unique violation translated. Separated so the translation is one obvious
 * thing rather than a catch wrapped around eighty lines.
 */
async function insertCase(
  tx: Tx,
  values: typeof disputeCases.$inferInsert,
): Promise<typeof disputeCases.$inferSelect> {
  try {
    const [row] = await tx.insert(disputeCases).values(values).returning();
    if (!row) throw new Error('disputes: the case insert returned no row');
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'dispute_cases_one_active_per_trade')) {
      throw disputeAlreadyOpen(values.tradeId);
    }
    throw error;
  }
}

export interface WithdrawInput {
  disputeId: string;
  userId: string;
  reason: string;
  actor: DisputeActor;
}

/**
 * SP-M23. Only the person who opened the dispute may withdraw it, and only while it is still in
 * mediation: once a reviewer is involved, closing the case is their decision to record, not a
 * party's to take back.
 */
export async function withdrawDispute(
  ports: DisputePorts,
  tx: Tx,
  input: WithdrawInput,
): Promise<DisputeView> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();
  if (partyRole(row, input.userId) === null) throw notADisputeParty();
  if (row.openedByUserId !== input.userId) throw onlyOpenerMayWithdraw();

  const now = ports.now();
  const updated = await moveCase(tx, row, {
    action: 'WITHDRAW',
    to: 'CLOSED',
    actor: input.actor,
    reason: input.reason,
    set: { closedAt: now },
  });

  await writeDisputeAudit(tx, input.actor, DISPUTE_AUDIT.WITHDRAWN, {
    disputeId: row.id,
    tradeId: row.tradeId,
    reason: input.reason,
  });

  await publish(tx, disputeClosed, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      from: row.status,
      reason: 'WITHDRAWN',
      closedAt: now.toISOString(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return toDisputeView(updated, now);
}

/** The case on a trade, for the workspace's DISPUTED body. Null when there is none. */
export async function disputeForTrade(
  db: Pick<Db, 'select'>,
  input: { tradeId: string; userId: string; now?: Date },
): Promise<DisputeView | null> {
  // A trade may have one open case and any number of closed ones; the workspace wants the live
  // one, and the newest closed one only when there is no live one.
  const [row] = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.tradeId, input.tradeId))
    .orderBy(asc(sql`${disputeCases.status} = 'CLOSED'`), desc(disputeCases.createdAt))
    .limit(1);
  if (!row) return null;
  if (partyRole(row, input.userId) === null) return null;
  return toDisputeView(row, input.now ?? new Date());
}
