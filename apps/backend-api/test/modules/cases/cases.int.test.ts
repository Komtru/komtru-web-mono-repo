// T-107 against a real database: registration, the staff write path (trail, audit row, outbox
// event), the work queue and its filters, and the append-only guarantees. Needs migrations 0040 and
// 0041; skipped unless KOMTRU_INFRA_TESTS=1.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeCaseForSubject,
  registerCase,
  syncCaseFacts,
  type CaseSubject,
  type RegisterCaseInput,
} from '../../../src/modules/cases/index.js';
import {
  decideCase,
  escalateCase,
  reassignCase,
  requestEvidence,
  resolveEvidenceRequest,
  setCasePriority,
  takeCase,
} from '../../../src/modules/cases/services/case.service.js';
import {
  getCaseDetail,
  listCases,
  listQueue,
  listTrail,
  queueCounts,
} from '../../../src/modules/cases/services/read.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { grantRole, outboxEventTypes, seedUser } from '../identity/support.js';

const POLICY = 'Disputes Policy §2.1';
let n = 0;
const input = (over: Partial<RegisterCaseInput> = {}): RegisterCaseInput => ({
  type: 'DISPUTE',
  subjectType: 'dispute',
  subjectId: `d-${(n += 1)}`,
  title: 'Item not as described',
  ...over,
});

describe.runIf(infraEnabled)('universal case index (T-107)', () => {
  const t = useTestDatabase();
  const db = () => t.db();
  const staff = async (role = 'OPERATIONS_ADMIN') => {
    const { userId } = await seedUser(t.app());
    await grantRole(t.owner(), userId, role, ['cases.manage']);
    return { userId };
  };
  const register = async (over: Partial<RegisterCaseInput> = {}) =>
    (await db().transaction((tx) => registerCase(tx, input(over)))).case;
  const trailTypes = async (caseId: string) =>
    (
      await t
        .owner()
        .query<{ type: string }>(`SELECT type FROM cases.case_trail WHERE case_id = $1 ORDER BY id`, [caseId])
    ).rows.map((r) => r.type);
  const auditActions = async () =>
    (
      await t.owner().query<{ action: string }>(`SELECT action FROM identity.identity_audit_log ORDER BY id`)
    ).rows.map((r) => r.action);

  beforeEach(() => {
    n = 0;
  });

  describe('registration', () => {
    it('indexes a record with its type’s SLA, a trail row and an event', async () => {
      const { case: row, created } = await db().transaction((tx) =>
        registerCase(tx, input({ type: 'KYB', subjectType: 'kyb_review' })),
      );
      expect(created).toBe(true);
      expect(row.state).toBe('OPEN');
      expect(row.slaHours).toBe(72);
      expect(row.slaDueAt.getTime() - row.slaStartedAt.getTime()).toBe(72 * 3_600_000);
      expect(await trailTypes(row.id)).toEqual(['REGISTERED']);
      expect(await outboxEventTypes(t.owner())).toEqual(['cases.case.registered']);
    });

    it('returns the same case for the same subject, and writes nothing the second time', async () => {
      const first = await register({ subjectId: 'x' });
      const again = await db().transaction((tx) =>
        registerCase(tx, input({ subjectId: 'x', title: 'changed' })),
      );
      expect(again.created).toBe(false);
      expect(again.case.id).toBe(first.id);
      expect(again.case.title).toBe('Item not as described');
      expect(await trailTypes(first.id)).toEqual(['REGISTERED']);
      expect(await outboxEventTypes(t.owner())).toHaveLength(1);
    });

    it('numbers cases in order', async () => {
      const a = await register();
      const b = await register();
      expect(b.caseNumber).toBe(a.caseNumber + 1);
    });

    it('merges facts for the advisory and records only the keys', async () => {
      const row = await register({ facts: { evidenceComplete: false } });
      const subject: CaseSubject = { type: row.type, subjectType: row.subjectType, subjectId: row.subjectId };
      await db().transaction((tx) => syncCaseFacts(tx, subject, { evidenceComplete: true, signalCount: 2 }));
      const detail = await getCaseDetail(db(), row.id);
      expect(detail.facts).toEqual({ evidenceComplete: true, signalCount: 2 });
      const { rows } = await t
        .owner()
        .query<{ metadata: { keys: string[] } }>(
          `SELECT metadata FROM cases.case_trail WHERE case_id = $1 AND type = 'FACTS_UPDATED'`,
          [row.id],
        );
      expect(rows[0]?.metadata).toEqual({ keys: ['evidenceComplete', 'signalCount'] });
    });

    it('is closed by the owning module, once', async () => {
      const row = await register();
      const subject: CaseSubject = { type: row.type, subjectType: row.subjectType, subjectId: row.subjectId };
      const closed = await db().transaction((tx) => closeCaseForSubject(tx, subject, 'REFUNDED'));
      expect(closed.state).toBe('CLOSED');
      await db().transaction((tx) => closeCaseForSubject(tx, subject, 'REFUNDED'));
      expect(await trailTypes(row.id)).toEqual(['REGISTERED', 'CLOSED']);
    });
  });

  describe('working a case', () => {
    it('is taken by one person; a second is refused and the first can repeat', async () => {
      const row = await register();
      const a = await staff();
      const b = await staff();
      const taken = await takeCase(db(), { actor: a, caseId: row.id });
      expect(taken.state).toBe('INVESTIGATING');
      expect(taken.ownerUserId).toBe(a.userId);
      await expect(takeCase(db(), { actor: b, caseId: row.id })).rejects.toMatchObject({ status: 409 });
      await takeCase(db(), { actor: a, caseId: row.id });
      expect(await trailTypes(row.id)).toEqual(['REGISTERED', 'TAKEN']);
      expect(await auditActions()).toContain('ADMIN_CASE_TAKEN');
    });

    it('is reassigned with a reason to someone who can work cases', async () => {
      const row = await register();
      const a = await staff();
      const b = await staff();
      await takeCase(db(), { actor: a, caseId: row.id });
      const moved = await reassignCase(db(), {
        actor: a,
        caseId: row.id,
        toUserId: b.userId,
        reason: 'Shift change',
      });
      expect(moved.ownerUserId).toBe(b.userId);
      const { rows } = await t
        .owner()
        .query<{ reason: string; metadata: { fromUserId: string; toUserId: string } }>(
          `SELECT reason, metadata FROM cases.case_trail WHERE case_id = $1 AND type = 'REASSIGNED'`,
          [row.id],
        );
      expect(rows[0]).toMatchObject({
        reason: 'Shift change',
        metadata: { fromUserId: a.userId, toUserId: b.userId },
      });
      expect(await auditActions()).toContain('ADMIN_CASE_REASSIGNED');
    });

    it('refuses a reassignment to a user without a case role', async () => {
      const row = await register();
      const a = await staff();
      const { userId: nobody } = await seedUser(t.app());
      const { userId: finance } = await seedUser(t.app());
      await grantRole(t.owner(), finance, 'SUPPORT_AGENT', []);
      for (const toUserId of [nobody, finance]) {
        await expect(
          reassignCase(db(), { actor: a, caseId: row.id, toUserId, reason: 'x' }),
        ).rejects.toMatchObject({ status: 422 });
      }
    });

    it('escalates, changes priority and parks on an evidence request', async () => {
      const row = await register();
      const a = await staff();
      await takeCase(db(), { actor: a, caseId: row.id });
      const high = await setCasePriority(db(), {
        actor: a,
        caseId: row.id,
        priority: 'URGENT',
        reason: 'Seller is a merchant',
      });
      expect(high.priority).toBe('URGENT');
      const { case: waiting, request } = await requestEvidence(db(), {
        actor: a,
        caseId: row.id,
        description: 'Photo of the box',
      });
      expect(waiting.state).toBe('AWAITING_EVIDENCE');
      const { case: back } = await resolveEvidenceRequest(db(), {
        actor: a,
        caseId: row.id,
        requestId: request.id,
        status: 'FULFILLED',
      });
      expect(back.state).toBe('INVESTIGATING');
      await expect(
        resolveEvidenceRequest(db(), {
          actor: a,
          caseId: row.id,
          requestId: request.id,
          status: 'CANCELLED',
        }),
      ).rejects.toMatchObject({ status: 409 });
      const escalated = await escalateCase(db(), { actor: a, caseId: row.id, reason: 'Needs an expert' });
      expect(escalated.state).toBe('ESCALATED');
      expect((await escalateCase(db(), { actor: a, caseId: row.id, reason: 'again' })).state).toBe(
        'ESCALATED',
      );
      expect(await trailTypes(row.id)).toEqual([
        'REGISTERED',
        'TAKEN',
        'PRIORITY_CHANGED',
        'EVIDENCE_REQUESTED',
        'EVIDENCE_RESOLVED',
        'ESCALATED',
      ]);
    });
  });

  describe('decisions', () => {
    it('writes the decision, the trust trail, the admin action log and the policy citation together', async () => {
      const row = await register();
      const a = await staff();
      await takeCase(db(), { actor: a, caseId: row.id });
      const { case: decided, decision } = await decideCase(db(), {
        actor: a,
        caseId: row.id,
        outcome: 'REFUND_BUYER',
        reason: 'Photos show the wrong model',
        policyCitation: POLICY,
      });
      expect(decided.state).toBe('DECIDED');
      expect(decided.sla.status).toBe('STOPPED');
      expect(decision.policyCitation).toBe(POLICY);

      const { rows: trail } = await t
        .owner()
        .query<{ reason: string; metadata: { policyCitation: string; decisionId: string } }>(
          `SELECT reason, metadata FROM cases.case_trail WHERE case_id = $1 AND type = 'DECISION_RECORDED'`,
          [row.id],
        );
      expect(trail[0]).toMatchObject({
        reason: 'Photos show the wrong model',
        metadata: { policyCitation: POLICY, decisionId: decision.id },
      });
      const { rows: audit } = await t
        .owner()
        .query<{ actor_user_id: string; metadata: Record<string, unknown> }>(
          `SELECT actor_user_id, metadata FROM identity.identity_audit_log WHERE action = 'ADMIN_CASE_DECIDED'`,
        );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor_user_id).toBe(a.userId);
      expect(audit[0]?.metadata).toMatchObject({
        caseId: row.id,
        outcome: 'REFUND_BUYER',
        policyCitation: POLICY,
        reason: 'Photos show the wrong model',
      });
      expect(await outboxEventTypes(t.owner())).toContain('cases.case.decided');
    });

    it('is the owner’s to make, once', async () => {
      const row = await register();
      const a = await staff();
      const b = await staff();
      const decide = (actor: { userId: string }) =>
        decideCase(db(), { actor, caseId: row.id, outcome: 'APPROVE', reason: 'ok', policyCitation: POLICY });
      await expect(decide(a)).rejects.toMatchObject({ status: 409 }); // unowned
      await takeCase(db(), { actor: a, caseId: row.id });
      await expect(decide(b)).rejects.toMatchObject({ status: 409 }); // not the owner
      await decide(a);
      await expect(decide(a)).rejects.toMatchObject({ status: 409 }); // already decided
      const { rows } = await t.owner().query(`SELECT 1 FROM cases.case_decisions`);
      expect(rows).toHaveLength(1);
    });

    it('cannot store a decision without a policy citation', async () => {
      const row = await register();
      const a = await staff();
      await expect(
        t.app().query(
          `INSERT INTO cases.case_decisions (case_id, decided_by_user_id, outcome, reason, policy_citation)
           VALUES ($1, $2, 'APPROVE', 'ok', '  ')`,
          [row.id, a.userId],
        ),
      ).rejects.toThrow(/case_decisions_citation_not_blank/);
    });
  });

  describe('the work queue', () => {
    it('splits live work into my work, unassigned, escalated and SLA at risk', async () => {
      const me = await staff();
      const other = await staff();
      const mine = await register({ title: 'mine' });
      const open = await register({ title: 'open' });
      const escalated = await register({ title: 'escalated' });
      const finished = await register({ title: 'finished' });
      const atRisk = await register({ title: 'at risk', slaHours: 4 });
      await takeCase(db(), { actor: me, caseId: mine.id });
      await takeCase(db(), { actor: other, caseId: escalated.id });
      await escalateCase(db(), { actor: other, caseId: escalated.id, reason: 'expert' });
      await takeCase(db(), { actor: me, caseId: finished.id });
      await decideCase(db(), {
        actor: me,
        caseId: finished.id,
        outcome: 'APPROVE',
        reason: 'ok',
        policyCitation: POLICY,
      });
      // 4h SLA, started 3h ago: inside the last quarter.
      await t
        .owner()
        .query(
          `UPDATE cases.cases SET sla_started_at = now() - interval '3 hours', sla_due_at = now() + interval '1 hour' WHERE id = $1`,
          [atRisk.id],
        );

      const titles = async (view: 'mine' | 'unassigned' | 'escalated' | 'sla_at_risk') =>
        (await listQueue(db(), { view, userId: me.userId, filters: {}, limit: 20 })).items
          .map((c) => c.title)
          .sort();
      expect(await titles('mine')).toEqual(['mine']);
      expect(await titles('unassigned')).toEqual(['at risk', 'open']);
      expect(await titles('escalated')).toEqual(['escalated']);
      expect(await titles('sla_at_risk')).toEqual(['at risk']);
      void open;

      expect(await queueCounts(db(), me.userId)).toEqual({
        mine: 1,
        mineUrgent: 0,
        unassigned: 2,
        escalated: 1,
        slaAtRisk: 1,
      });
    });

    it('is ordered by the clock, filters, and pages without losing or repeating a case', async () => {
      const me = await staff();
      for (let i = 0; i < 5; i += 1) {
        await register({
          type: i % 2 === 0 ? 'DISPUTE' : 'KYB',
          subjectType: i % 2 === 0 ? 'dispute' : 'kyb_review',
          title: `c${i}`,
        });
      }
      const all: string[] = [];
      let cursor: undefined | { d: string; id: string };
      for (;;) {
        const page = await listQueue(db(), {
          view: 'unassigned',
          userId: me.userId,
          filters: {},
          limit: 2,
          cursor,
        });
        all.push(...page.items.map((c) => c.title));
        if (!page.nextCursor) break;
        cursor = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString()) as {
          d: string;
          id: string;
        };
      }
      // Disputes (48h) are due before KYB (72h) reviews registered a moment apart; each group keeps registration order.
      expect(all).toHaveLength(5);
      expect(new Set(all).size).toBe(5);
      expect(all.slice(0, 3).sort()).toEqual(['c0', 'c2', 'c4']);

      const kyb = await listQueue(db(), {
        view: 'unassigned',
        userId: me.userId,
        filters: { type: 'KYB' },
        limit: 20,
      });
      expect(kyb.items.map((c) => c.title).sort()).toEqual(['c1', 'c3']);
    });

    it('lists every case newest first with the universal filters', async () => {
      const me = await staff();
      const first = await register({ title: 'first' });
      const second = await register({ title: 'second', priority: 'URGENT' });
      await takeCase(db(), { actor: me, caseId: first.id });
      await decideCase(db(), {
        actor: me,
        caseId: first.id,
        outcome: 'APPROVE',
        reason: 'ok',
        policyCitation: POLICY,
      });

      const page1 = await listCases(db(), { filters: {}, limit: 1 });
      expect(page1.items.map((c) => c.title)).toEqual(['second']);
      const cursor = JSON.parse(Buffer.from(page1.nextCursor ?? '', 'base64url').toString()) as { n: number };
      const page2 = await listCases(db(), { filters: {}, limit: 1, cursor });
      expect(page2.items.map((c) => c.title)).toEqual(['first']);
      expect(page2.nextCursor).toBeNull();

      const titles = async (filters: Parameters<typeof listCases>[1]['filters']) =>
        (await listCases(db(), { filters, limit: 20 })).items.map((c) => c.title);
      expect(await titles({ priority: 'URGENT' })).toEqual(['second']);
      expect(await titles({ state: 'DECIDED' })).toEqual(['first']);
      expect(await titles({ owner: me.userId })).toEqual(['first']);
      expect(await titles({ owner: 'none' })).toEqual(['second']);
      expect(await titles({ subjectType: 'dispute', subjectId: second.subjectId })).toEqual(['second']);
      expect(await titles({ q: `C-${String(first.caseNumber).padStart(6, '0')}` })).toEqual(['first']);
      expect(await titles({ q: 'not-a-number' })).toEqual([]);
    });

    it('pages the trust trail newest first', async () => {
      const me = await staff();
      const row = await register();
      await takeCase(db(), { actor: me, caseId: row.id });
      await setCasePriority(db(), { actor: me, caseId: row.id, priority: 'HIGH', reason: 'r' });
      const page1 = await listTrail(db(), row.id, { limit: 2 });
      expect(page1.items.map((i) => i.type)).toEqual(['PRIORITY_CHANGED', 'TAKEN']);
      const cursor = JSON.parse(Buffer.from(page1.nextCursor ?? '', 'base64url').toString()) as {
        id: number;
      };
      const page2 = await listTrail(db(), row.id, { limit: 2, cursor });
      expect(page2.items.map((i) => i.type)).toEqual(['REGISTERED']);
      await expect(
        listTrail(db(), '00000000-0000-4000-8000-000000000000', { limit: 2 }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('append-only', () => {
    it('refuses to change or remove a decision or a trail row, even for the owner', async () => {
      const me = await staff();
      const row = await register();
      await takeCase(db(), { actor: me, caseId: row.id });
      await decideCase(db(), {
        actor: me,
        caseId: row.id,
        outcome: 'APPROVE',
        reason: 'ok',
        policyCitation: POLICY,
      });
      for (const pool of [t.app(), t.owner()]) {
        await expect(pool.query(`UPDATE cases.case_decisions SET outcome = 'REJECT'`)).rejects.toThrow();
        await expect(pool.query(`DELETE FROM cases.case_decisions`)).rejects.toThrow();
        await expect(pool.query(`UPDATE cases.case_trail SET reason = 'edited'`)).rejects.toThrow();
        await expect(pool.query(`DELETE FROM cases.case_trail`)).rejects.toThrow();
      }
      await expect(t.app().query(`DELETE FROM cases.cases`)).rejects.toThrow(/foreign key/); // the decisions and trail it holds keep it alive
    });
  });
});
