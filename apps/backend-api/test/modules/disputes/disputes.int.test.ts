// T-080 and T-081 against a real database: the invariants that only Postgres can actually prove.
// Needs migrations 0054 and 0055; skipped unless KOMTRU_INFRA_TESTS=1.
//
// WHY THESE CASES AND NOT OTHERS: the pure rules are already covered by the domain unit tests, and
// repeating them here against a database would buy nothing. What is here is everything a service
// could get wrong in a way no unit test can see — the partial unique index deciding a race, the
// trigger refusing a decision whose amounts do not add up, and the append-only guard refusing an
// edit even to the owner. Those three are the ones that move money.
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTransition, trades } from '../../../src/modules/trades/index.js';
import { openDispute, withdrawDispute } from '../../../src/modules/disputes/services/dispute.service.js';
import {
  proposeMediation,
  respondToMediation,
} from '../../../src/modules/disputes/services/mediation.service.js';
import { submitEvidence } from '../../../src/modules/disputes/services/evidence.service.js';
import { decideDispute, assignReviewer } from '../../../src/modules/disputes/services/review.service.js';
import { fileAppeal } from '../../../src/modules/disputes/services/appeal.service.js';
import {
  sweepAppealDeadlines,
  sweepEvidenceDeadlines,
  sweepMediationDeadlines,
} from '../../../src/modules/disputes/services/sweeps.js';
import type { DisputePorts } from '../../../src/modules/disputes/services/ports.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { outboxEventTypes, seedUser } from '../identity/support.js';
import { driveTo, insertTrade, testFeeSnapshot } from '../trades/support.js';

const ESCROW = 45_200_000n;

describe.runIf(infraEnabled)('disputes core (T-080)', () => {
  const t = useTestDatabase();
  const db = () => t.db();

  let buyer: string;
  let seller: string;
  let reviewer: string;
  let tradeId: string;
  let clock: Date;

  /**
   * Real ports except the two that reach modules this suite is not exercising: the trade read and
   * the trade transition are the genuine adapters, so M3 D1's "the trade becomes DISPUTED in the
   * same transaction" is actually tested.
   */
  const ports = (): DisputePorts => ({
    db: db(),
    now: () => clock,
    tradeForDispute: async (tx, input) => {
      const [row] = await tx.select().from(trades).where(eq(trades.id, input.tradeId));
      if (!row?.buyerUserId || !row.sellerUserId) return null;
      if (row.buyerUserId !== input.userId && row.sellerUserId !== input.userId) return null;
      return {
        tradeId: row.id,
        tradeCode: row.tradeCode,
        status: row.status,
        buyerUserId: row.buyerUserId,
        sellerUserId: row.sellerUserId,
        orderId: null,
        itemAmountMinor: ESCROW,
        currency: 'NGN',
      };
    },
    moveTradeToDisputed: async (tx, input) => {
      await applyTransition(tx, {
        tradeId: input.tradeId,
        action: 'DISPUTE',
        to: 'DISPUTED',
        actor: { type: 'BUYER', id: input.actorUserId },
      });
    },
    tradeMedia: () => Promise.resolve([]),
    custodyPhotos: () => Promise.resolve([]),
    shipmentTimeline: () => Promise.resolve([]),
    grantEvidenceAccess: () => Promise.resolve(),
    relatedUsers: () => Promise.resolve({ sharedDeviceUserIds: [], sharedPayoutUserIds: [] }),
    mediationWindowHours: () => Promise.resolve(48),
    evidenceWindowDays: () => Promise.resolve(5),
    appealWindowDays: () => Promise.resolve(7),
  });

  const actor = (userId: string) => ({ userId });

  const open = (over: { userId?: string } = {}) =>
    db().transaction((tx) =>
      openDispute(ports(), tx, {
        tradeId,
        openedByUserId: over.userId ?? buyer,
        category: 'ITEM_NOT_AS_DESCRIBED',
        reason: 'The listing said Sierra Blue but I received a Midnight black unit.',
        creationPath: 'DIRECT_FILING',
        actor: actor(over.userId ?? buyer),
      }),
    );

  const statusOf = async (disputeId: string) => {
    const { rows } = await t
      .owner()
      .query<{ status: string }>('SELECT status FROM disputes.dispute_cases WHERE id = $1', [disputeId]);
    return rows[0]?.status;
  };

  beforeEach(async () => {
    clock = new Date('2026-11-19T09:00:00.000Z');
    buyer = (await seedUser(t.app())).userId;
    seller = (await seedUser(t.app())).userId;
    reviewer = (await seedUser(t.app())).userId;
    tradeId = await insertTrade(t.owner(), { buyer, seller }, testFeeSnapshot(ESCROW));
    await driveTo(t.owner(), tradeId, 'INSPECTION');
  });

  // ------------------------------------------------------------------ D1 and the race
  it('opens into mediation, moves the trade to DISPUTED and indexes a case', async () => {
    const dispute = await open();
    expect(dispute.status).toBe('MEDIATION');
    expect(dispute.code).toMatch(/^DIS-\d{6}$/);
    expect(dispute.totalEscrowMinor).toBe(ESCROW.toString());

    const { rows: trade } = await t
      .owner()
      .query<{ status: string }>('SELECT status FROM trade.trades WHERE id = $1', [tradeId]);
    expect(trade[0]?.status).toBe('DISPUTED');

    const { rows: cases } = await t
      .owner()
      .query<{ subject_id: string; type: string }>(
        "SELECT subject_id, type FROM cases.cases WHERE type = 'DISPUTE'",
      );
    expect(cases[0]?.subject_id).toBe(dispute.id);

    expect(await outboxEventTypes(t.owner())).toContain('disputes.dispute.opened');
  });

  it('writes the opening row of the timeline with no previous status', async () => {
    const dispute = await open();
    const { rows } = await t
      .owner()
      .query<{ from_status: string | null; action: string }>(
        'SELECT from_status, action FROM disputes.dispute_status_changes WHERE dispute_id = $1 ORDER BY id',
        [dispute.id],
      );
    expect(rows).toEqual([{ from_status: null, action: 'OPEN' }]);
  });

  it('REVIEW FOCUS 1: two parties filing at once leave exactly one case', async () => {
    // Both transactions run against the same trade. The partial unique index decides it; a
    // check-then-insert in the service would let both through.
    const results = await Promise.allSettled([open({ userId: buyer }), open({ userId: seller })]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // The loser gets a 409 that names the situation, never a 500 out of a raw unique violation.
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    const { rows } = await t.owner().query('SELECT id FROM disputes.dispute_cases');
    expect(rows).toHaveLength(1);
  });

  it('allows a second dispute once the first is closed', async () => {
    const first = await open();
    await db().transaction((tx) =>
      withdrawDispute(ports(), tx, {
        disputeId: first.id,
        userId: buyer,
        reason: 'We sorted it out together',
        actor: actor(buyer),
      }),
    );
    await driveTo(t.owner(), tradeId, 'INSPECTION');
    await expect(open()).resolves.toMatchObject({ status: 'MEDIATION' });
  });

  // ------------------------------------------------------------------ D4 and the trigger
  it('REVIEW FOCUS 2: the trigger refuses a decision whose amounts do not sum to the escrow', async () => {
    const dispute = await open();
    // Written directly as the OWNER, going round the service and its application-level check, so
    // this proves the database refuses it on its own.
    await expect(
      t.owner().query(
        `INSERT INTO disputes.dispute_decision_log
           (dispute_id, decision_type, decided_by_user_id, outcome,
            amount_to_buyer_minor, amount_to_seller_minor, rationale)
         VALUES ($1, 'ORIGINAL', $2, 'REFUND_BUYER_PARTIAL', 1, 1, 'does not add up')`,
        [dispute.id, reviewer],
      ),
    ).rejects.toThrow(/do not sum to the escrowed total/);
  });

  it('accepts a decision whose amounts do sum to the escrow', async () => {
    const dispute = await open();
    await expect(
      t.owner().query(
        `INSERT INTO disputes.dispute_decision_log
           (dispute_id, decision_type, decided_by_user_id, outcome,
            amount_to_buyer_minor, amount_to_seller_minor, rationale)
         VALUES ($1, 'ORIGINAL', $2, 'REFUND_BUYER_FULL', $3, 0, 'the colour did not match')`,
        [dispute.id, reviewer, ESCROW.toString()],
      ),
    ).resolves.toBeTruthy();
  });

  // ------------------------------------------------------------------ D6, append-only
  it('refuses an UPDATE or a DELETE on the decision log, even as the owner', async () => {
    const dispute = await open();
    await t.owner().query(
      `INSERT INTO disputes.dispute_decision_log
         (dispute_id, decision_type, decided_by_user_id, outcome,
          amount_to_buyer_minor, amount_to_seller_minor, rationale)
       VALUES ($1, 'ORIGINAL', $2, 'REFUND_BUYER_FULL', $3, 0, 'the colour did not match')`,
      [dispute.id, reviewer, ESCROW.toString()],
    );
    await expect(
      t.owner().query('UPDATE disputes.dispute_decision_log SET rationale = $1', ['edited']),
    ).rejects.toThrow();
    await expect(t.owner().query('DELETE FROM disputes.dispute_decision_log')).rejects.toThrow();
  });

  it('refuses an UPDATE on the status log', async () => {
    const dispute = await open();
    await expect(
      t
        .owner()
        .query('UPDATE disputes.dispute_status_changes SET action = $1 WHERE dispute_id = $2', [
          'TAMPERED',
          dispute.id,
        ]),
    ).rejects.toThrow();
  });

  // ------------------------------------------------------------------ C13 mediation
  it('resolves without a reviewer when the other party accepts an offer', async () => {
    const dispute = await open();
    const proposal = await db().transaction((tx) =>
      proposeMediation(ports(), tx, {
        disputeId: dispute.id,
        userId: seller,
        outcome: 'REFUND_BUYER_FULL',
        amounts: { toBuyerMinor: ESCROW, toSellerMinor: 0n },
        note: 'Send it back whenever suits; refund goes out today.',
        actor: actor(seller),
      }),
    );

    const result = await db().transaction((tx) =>
      respondToMediation(ports(), tx, {
        disputeId: dispute.id,
        proposalId: proposal.id,
        userId: buyer,
        accept: true,
        actor: actor(buyer),
      }),
    );

    expect(result.dispute?.status).toBe('DECIDED');
    expect(await outboxEventTypes(t.owner())).toEqual(
      expect.arrayContaining(['disputes.mediation.agreed', 'disputes.dispute.resolved']),
    );

    const { rows } = await t
      .owner()
      .query<{ decision_type: string; decided_by_user_id: string | null; agreed_note: string }>(
        'SELECT decision_type, decided_by_user_id, agreed_note FROM disputes.dispute_decision_log WHERE dispute_id = $1',
        [dispute.id],
      );
    // Q10: the agreed words survive; no reviewer decided it.
    expect(rows[0]?.decision_type).toBe('MEDIATED');
    expect(rows[0]?.decided_by_user_id).toBeNull();
    expect(rows[0]?.agreed_note).toContain('Send it back');
  });

  it('refuses a party accepting their own offer', async () => {
    const dispute = await open();
    const proposal = await db().transaction((tx) =>
      proposeMediation(ports(), tx, {
        disputeId: dispute.id,
        userId: seller,
        outcome: 'RELEASE_SELLER_FULL',
        amounts: { toBuyerMinor: 0n, toSellerMinor: ESCROW },
        actor: actor(seller),
      }),
    );
    await expect(
      db().transaction((tx) =>
        respondToMediation(ports(), tx, {
          disputeId: dispute.id,
          proposalId: proposal.id,
          userId: seller,
          accept: true,
          actor: actor(seller),
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('supersedes a party’s previous offer rather than stacking two live ones', async () => {
    const dispute = await open();
    for (const amount of [ESCROW, ESCROW - 1_000_000n]) {
      await db().transaction((tx) =>
        proposeMediation(ports(), tx, {
          disputeId: dispute.id,
          userId: seller,
          outcome: 'REFUND_BUYER_PARTIAL',
          amounts: { toBuyerMinor: amount, toSellerMinor: ESCROW - amount },
          actor: actor(seller),
        }),
      );
    }
    const { rows } = await t
      .owner()
      .query<{ status: string }>(
        "SELECT status FROM disputes.dispute_mediation_proposals WHERE dispute_id = $1 AND status = 'PROPOSED'",
        [dispute.id],
      );
    expect(rows).toHaveLength(1);
  });

  // ------------------------------------------------------------------ the windows
  it('escalates to evidence collection when the mediation window lapses', async () => {
    const dispute = await open();
    clock = new Date('2026-11-22T09:00:00.000Z');
    const result = await sweepMediationDeadlines({ db: db(), ports: ports() });
    expect(result.moved).toBe(1);
    expect(await statusOf(dispute.id)).toBe('OPEN_EVIDENCE_COLLECTION');
  });

  it('sends the case to review when the evidence window lapses', async () => {
    const dispute = await open();
    clock = new Date('2026-11-22T09:00:00.000Z');
    await sweepMediationDeadlines({ db: db(), ports: ports() });
    clock = new Date('2026-11-25T09:00:00.000Z');
    await sweepEvidenceDeadlines({ db: db(), ports: ports() });
    expect(await statusOf(dispute.id)).toBe('UNDER_REVIEW');
    expect(await outboxEventTypes(t.owner())).toContain('disputes.evidence.window_closed');
  });

  it('REVIEW FOCUS 3: refuses evidence after the deadline unless collection was reopened', async () => {
    const dispute = await open();
    clock = new Date('2026-11-22T09:00:00.000Z');
    await sweepMediationDeadlines({ db: db(), ports: ports() });

    // One millisecond past the deadline, with no reopen.
    clock = new Date('2026-11-24T09:00:00.001Z');
    await expect(
      db().transaction((tx) =>
        submitEvidence(ports(), tx, {
          disputeId: dispute.id,
          userId: buyer,
          note: 'One more photo',
          actor: actor(buyer),
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('closes a decided case when its appeal window lapses, with no appeal', async () => {
    const dispute = await decided();
    clock = new Date('2026-12-05T09:00:00.000Z');
    const result = await sweepAppealDeadlines({ db: db(), ports: ports() });
    expect(result.moved).toBe(1);
    expect(await statusOf(dispute.id)).toBe('CLOSED');
  });

  // ------------------------------------------------------------------ D3 and D5
  it('refuses to assign a reviewer who is a party to the case', async () => {
    const dispute = await underReview();
    await expect(
      db().transaction((tx) =>
        assignReviewer(ports(), tx, { disputeId: dispute.id, reviewerId: buyer, actor: actor(reviewer) }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('REVIEW FOCUS 4: allows one appeal and refuses the second', async () => {
    const dispute = await decided();
    await db().transaction((tx) =>
      fileAppeal(ports(), tx, {
        disputeId: dispute.id,
        userId: buyer,
        reason: 'The unit was still sealed on arrival.',
        actor: actor(buyer),
      }),
    );
    expect(await statusOf(dispute.id)).toBe('APPEALED');

    await expect(
      db().transaction((tx) =>
        fileAppeal(ports(), tx, {
          disputeId: dispute.id,
          userId: seller,
          reason: 'Trying again',
          actor: actor(seller),
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses an appeal filed after the window', async () => {
    const dispute = await decided();
    clock = new Date('2026-12-05T09:00:00.000Z');
    await expect(
      db().transaction((tx) =>
        fileAppeal(ports(), tx, {
          disputeId: dispute.id,
          userId: buyer,
          reason: 'Too late',
          actor: actor(buyer),
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a non-party as if the dispute did not exist', async () => {
    const dispute = await open();
    await expect(
      db().transaction((tx) =>
        submitEvidence(ports(), tx, {
          disputeId: dispute.id,
          userId: reviewer,
          note: 'Not mine to touch',
          actor: actor(reviewer),
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  // ------------------------------------------------------------------ helpers
  async function underReview() {
    const dispute = await open();
    clock = new Date('2026-11-22T09:00:00.000Z');
    await sweepMediationDeadlines({ db: db(), ports: ports() });
    clock = new Date('2026-11-25T09:00:00.000Z');
    await sweepEvidenceDeadlines({ db: db(), ports: ports() });
    return dispute;
  }

  async function decided() {
    const dispute = await underReview();
    await db().transaction((tx) =>
      decideDispute(ports(), tx, {
        disputeId: dispute.id,
        reviewerId: reviewer,
        outcome: 'REFUND_BUYER_FULL',
        amounts: { toBuyerMinor: ESCROW, toSellerMinor: 0n },
        rationale: 'The delivered item’s colour did not match the listing as agreed in §2.',
        actor: actor(reviewer),
      }),
    );
    return dispute;
  }
});
