// Review fixes for T-107: cursor shape, concurrency, re-registration of a finished subject, the
// system actor on evidence, and the evidence requestee.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeCaseForSubject,
  registerCase,
  type RegisterCaseInput,
} from '../../../src/modules/cases/index.js';
import {
  decideCase,
  requestEvidence,
  resolveEvidenceRequest,
  takeCase,
} from '../../../src/modules/cases/services/case.service.js';
import { listCases, listQueue, listTrail } from '../../../src/modules/cases/services/read.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { grantRole, seedUser } from '../identity/support.js';

let n = 0;
const input = (over: Partial<RegisterCaseInput> = {}): RegisterCaseInput => ({
  type: 'DISPUTE',
  subjectType: 'dispute',
  subjectId: `h-${(n += 1)}`,
  title: 'Item not as described',
  ...over,
});
const outcomes = <T>(results: PromiseSettledResult<T>[]) => ({
  ok: results.filter((r) => r.status === 'fulfilled').length,
  failed: results.filter((r) => r.status === 'rejected').length,
});

describe.runIf(infraEnabled)('T-107 review fixes', () => {
  const t = useTestDatabase();
  const db = () => t.db();
  const staff = async () => {
    const { userId } = await seedUser(t.app());
    await grantRole(t.owner(), userId, 'OPERATIONS_ADMIN', ['cases.manage']);
    return { userId };
  };
  const register = async (over: Partial<RegisterCaseInput> = {}) =>
    (await db().transaction((tx) => registerCase(tx, input(over)))).case;
  const rejects422 = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ status: 422 });

  beforeEach(() => {
    n = 0;
  });

  describe('cursors of the wrong shape', () => {
    it('are a 422 on the queue, the list and the trail, never page one again', async () => {
      const me = await staff();
      const row = await register();
      const queue = (cursor: Record<string, string | number | null>) =>
        listQueue(db(), { view: 'unassigned', userId: me.userId, filters: {}, limit: 1, cursor });
      await rejects422(queue({ x: 1 }));
      await rejects422(queue({ d: 'not-a-date', id: row.id }));
      await rejects422(queue({ d: new Date().toISOString(), id: 'nope' }));
      await rejects422(listCases(db(), { filters: {}, limit: 1, cursor: { x: 1 } }));
      await rejects422(listCases(db(), { filters: {}, limit: 1, cursor: { n: 'abc' } }));
      await rejects422(listTrail(db(), row.id, { limit: 1, cursor: { x: 1 } }));
      await rejects422(listTrail(db(), row.id, { limit: 1, cursor: { id: 'abc' } }));
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of two takes win', async () => {
      const row = await register();
      const [a, b] = [await staff(), await staff()];
      const res = await Promise.allSettled([
        takeCase(db(), { actor: a, caseId: row.id }),
        takeCase(db(), { actor: b, caseId: row.id }),
      ]);
      expect(outcomes(res)).toEqual({ ok: 1, failed: 1 });
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM cases.case_trail WHERE case_id = $1 AND type = 'TAKEN'`, [row.id]);
      expect(rows).toHaveLength(1);
    });

    it('lets exactly one of two decisions win', async () => {
      const row = await register();
      const a = await staff();
      await takeCase(db(), { actor: a, caseId: row.id });
      const decide = (outcome: string) =>
        decideCase(db(), { actor: a, caseId: row.id, outcome, reason: 'r', policyCitation: 'P §1' });
      const res = await Promise.allSettled([decide('APPROVE'), decide('REJECT')]);
      expect(outcomes(res)).toEqual({ ok: 1, failed: 1 });
      const { rows } = await t.owner().query(`SELECT 1 FROM cases.case_decisions`);
      expect(rows).toHaveLength(1);
    });

    it('registers one case for two simultaneous registrations of a subject', async () => {
      const same = input({ subjectId: 'same' });
      const res = await Promise.all([
        db().transaction((tx) => registerCase(tx, same)),
        db().transaction((tx) => registerCase(tx, same)),
      ]);
      expect(res.filter((r) => r.created)).toHaveLength(1);
      expect(res[0]?.case.id).toBe(res[1]?.case.id);
      const { rows } = await t.owner().query(`SELECT 1 FROM cases.case_trail WHERE type = 'REGISTERED'`);
      expect(rows).toHaveLength(1);
    });
  });

  describe('registering a subject whose case is finished', () => {
    it('says so, so the caller can act', async () => {
      const first = await db().transaction((tx) => registerCase(tx, input({ subjectId: 'f' })));
      expect(first.created).toBe(true);
      expect(first.reopenRequired).toBe(false);
      const again = await db().transaction((tx) => registerCase(tx, input({ subjectId: 'f' })));
      expect(again.reopenRequired).toBe(false);
      await db().transaction((tx) =>
        closeCaseForSubject(tx, { type: 'DISPUTE', subjectType: 'dispute', subjectId: 'f' }, 'X'),
      );
      const closed = await db().transaction((tx) => registerCase(tx, input({ subjectId: 'f' })));
      expect(closed).toMatchObject({ created: false, reopenRequired: true });
      expect(closed.case.state).toBe('CLOSED');
    });
  });

  describe('evidence', () => {
    it('records the calling module when the system resolves a request', async () => {
      const row = await register();
      const a = await staff();
      const { request } = await requestEvidence(db(), { actor: a, caseId: row.id, description: 'photo' });
      await resolveEvidenceRequest(db(), {
        actor: null,
        source: 'files.upload',
        caseId: row.id,
        requestId: request.id,
        status: 'FULFILLED',
      });
      const { rows } = await t
        .owner()
        .query<{ metadata: Record<string, unknown>; actor_user_id: string | null }>(
          `SELECT metadata, actor_user_id FROM cases.case_trail WHERE case_id = $1 AND type = 'EVIDENCE_RESOLVED'`,
          [row.id],
        );
      expect(rows[0]?.actor_user_id).toBeNull();
      expect(rows[0]?.metadata).toMatchObject({ systemActor: 'files.upload', status: 'FULFILLED' });
    });

    it('refuses a request addressed to a user who does not exist', async () => {
      const row = await register();
      const a = await staff();
      await rejects422(
        requestEvidence(db(), {
          actor: a,
          caseId: row.id,
          description: 'photo',
          fromUserId: '00000000-0000-4000-8000-000000000000',
        }),
      );
      const { userId } = await seedUser(t.app());
      await requestEvidence(db(), { actor: a, caseId: row.id, description: 'photo', fromUserId: userId });
    });
  });
});
