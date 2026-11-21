// F-065: the roster races. Every roster change takes the company row's lock and then re-reads the acting
// admin under it, so two admins changing each other at the same instant settle as one serial order.
// The tests force the order: a rival transaction holds the company lock while the requests queue up
// behind it, so which request runs first is decided by the test and not by the scheduler.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, redisReady } from '../identity/support.js';
import {
  bodyOf,
  seedCatalogue,
  seedMember,
  type Member,
  type Problem,
} from '../identity/http/staff.support.js';
import { buildLogisticsApp, insertCompany, insertMember, logisticsSession, memberStatus } from './support.js';

interface Admin {
  person: Member;
  memberId: string;
  token: string;
}

describe.runIf(infraEnabled)('logistics roster concurrency (F-065)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    app = buildLogisticsApp(t, redis).app;
  });
  afterAll(() => {
    redis?.disconnect();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function company(admins: number): Promise<{ companyId: string; team: Admin[] }> {
    const companyId = await insertCompany(t, 'Swift Couriers');
    const team: Admin[] = [];
    for (let i = 0; i < admins; i += 1) {
      const person = await seedMember(t, app);
      const memberId = await insertMember(t, {
        companyId,
        userId: person.userId,
        role: 'ADMIN',
        status: 'ACTIVE',
      });
      team.push({ person, memberId, token: await logisticsSession(app, person.email) });
    }
    return { companyId, team };
  }

  const patch = (by: Admin, target: Admin, body: object) =>
    request(app).patch(`/v1/logistics/members/${target.memberId}`).set(bearer(by.token)).send(body);

  /** How many statements are waiting on a row lock in this worker's database right now. */
  const lockWaiters = async (): Promise<number> =>
    Number(
      (
        await t.owner().query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'`,
        )
      ).rows[0]?.n ?? 0,
    );

  async function untilWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 8_000;
    while ((await lockWaiters()) < count) {
      if (Date.now() > deadline) throw new Error(`expected ${count} requests waiting on the company lock`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * Holds the company row while `first` and then `second` are sent, and releases it once both are
   * queued behind it. Postgres grants the row lock in arrival order, so `first` runs first.
   */
  async function inOrder<A, B>(
    companyId: string,
    first: () => PromiseLike<A>,
    second: () => PromiseLike<B>,
  ): Promise<[A, B]> {
    const rival = await t.owner().connect();
    try {
      await rival.query('BEGIN');
      await rival.query(`SELECT id FROM logistics.logistics_companies WHERE id = $1 FOR UPDATE`, [companyId]);
      const one = Promise.resolve(first());
      await untilWaiters(1);
      const two = Promise.resolve(second());
      await untilWaiters(2);
      await rival.query('COMMIT');
      return await Promise.all([one, two]);
    } finally {
      rival.release();
    }
  }

  /** The people removed from this company, in the order the removals committed (the audit is append-only). */
  const removals = async (companyId: string): Promise<string[]> =>
    (
      await t.app().query<{ subject: string }>(
        `SELECT subject_user_id AS subject FROM identity.identity_audit_log
            WHERE action = 'LOGISTICS_MEMBER_REMOVED' AND metadata->>'companyId' = $1 ORDER BY id`,
        [companyId],
      )
    ).rows.map((row) => row.subject);

  describe('A removes B while B removes C', () => {
    it('refuses B once A has removed B: C stays, and only one removal happened', async () => {
      const {
        companyId,
        team: [a, b, c],
      } = await company(3);
      const [fromA, fromB] = await inOrder(
        companyId,
        () => patch(a!, b!, { status: 'REMOVED' }),
        () => patch(b!, c!, { status: 'REMOVED' }),
      );
      expect(fromA.status).toBe(200);
      expect(fromB.status).toBe(403);
      expect(bodyOf<Problem>(fromB).code).toBe('FORBIDDEN');
      expect(await memberStatus(t, a!.memberId)).toBe('ACTIVE');
      expect(await memberStatus(t, b!.memberId)).toBe('REMOVED');
      expect(await memberStatus(t, c!.memberId)).toBe('ACTIVE');
      expect(await removals(companyId)).toEqual([b!.person.userId]);
    }, 30_000);

    it('lets B finish first when B got the lock first, and then removes B: serial, both succeed', async () => {
      const {
        companyId,
        team: [a, b, c],
      } = await company(3);
      const [fromB, fromA] = await inOrder(
        companyId,
        () => patch(b!, c!, { status: 'REMOVED' }),
        () => patch(a!, b!, { status: 'REMOVED' }),
      );
      expect([fromB.status, fromA.status]).toEqual([200, 200]);
      expect(await removals(companyId)).toEqual([c!.person.userId, b!.person.userId]);
      expect(await memberStatus(t, a!.memberId)).toBe('ACTIVE');
    }, 30_000);

    it('never lets a removed admin remove anyone, over unforced races', async () => {
      for (let round = 0; round < 5; round += 1) {
        const {
          companyId,
          team: [a, b, c],
        } = await company(3);
        const [fromA, fromB] = await Promise.all([
          patch(a!, b!, { status: 'REMOVED' }),
          patch(b!, c!, { status: 'REMOVED' }),
        ]);
        expect(fromA.status).toBe(200);
        expect([200, 403]).toContain(fromB.status);
        const log = await removals(companyId);
        // The only order that is wrong: B removed first, then the removed B removing C.
        if (fromB.status === 200) expect(log).toEqual([c!.person.userId, b!.person.userId]);
        else {
          expect(log).toEqual([b!.person.userId]);
          expect(await memberStatus(t, c!.memberId)).toBe('ACTIVE');
        }
      }
    }, 90_000);
  });

  describe('the last admin', () => {
    it('keeps one admin when two admins demote each other at once', async () => {
      const {
        companyId,
        team: [a, b],
      } = await company(2);
      const [fromA, fromB] = await inOrder(
        companyId,
        () => patch(a!, b!, { role: 'OPERATOR' }),
        () => patch(b!, a!, { role: 'OPERATOR' }),
      );
      expect(fromA.status).toBe(200);
      // The second request is by an admin demoted a moment ago, so the acting-admin re-check answers
      // first (403); LAST_ADMIN is the guard behind it. Either way it changes nothing.
      expect([403, 409]).toContain(fromB.status);
      if (fromB.status === 409) expect(bodyOf<Problem>(fromB).code).toBe('LAST_ADMIN');
      const { rows } = await t
        .app()
        .query<{ id: string; role: string }>(
          `SELECT id, role::text AS role FROM logistics.logistics_company_members WHERE company_id = $1`,
          [companyId],
        );
      expect(rows.filter((row) => row.role === 'ADMIN').map((row) => row.id)).toEqual([a!.memberId]);
    }, 30_000);

    it('answers 409 LAST_ADMIN to the second of two admins who each demote themselves', async () => {
      const {
        companyId,
        team: [a, b],
      } = await company(2);
      const [fromA, fromB] = await inOrder(
        companyId,
        () => patch(a!, a!, { role: 'OPERATOR' }),
        () => patch(b!, b!, { role: 'OPERATOR' }),
      );
      expect(fromA.status).toBe(200);
      expect(fromB.status).toBe(409);
      expect(bodyOf<Problem>(fromB).code).toBe('LAST_ADMIN');
      const { rows } = await t
        .app()
        .query<{ id: string }>(
          `SELECT id FROM logistics.logistics_company_members WHERE company_id = $1 AND role = 'ADMIN'`,
          [companyId],
        );
      expect(rows.map((row) => row.id)).toEqual([b!.memberId]);
    }, 30_000);

    it('keeps one admin when two admins remove each other, unforced, over several rounds', async () => {
      for (let round = 0; round < 4; round += 1) {
        const {
          companyId,
          team: [a, b],
        } = await company(2);
        const [fromA, fromB] = await Promise.all([
          patch(a!, b!, { status: 'REMOVED' }),
          patch(b!, a!, { status: 'REMOVED' }),
        ]);
        const statuses = [fromA.status, fromB.status].sort();
        expect(statuses[0]).toBe(200);
        expect([403, 409]).toContain(statuses[1]);
        const { rows } = await t.app().query(
          `SELECT 1 FROM logistics.logistics_company_members
              WHERE company_id = $1 AND role = 'ADMIN' AND status = 'ACTIVE'`,
          [companyId],
        );
        expect(rows).toHaveLength(1);
      }
    }, 90_000);
  });
});
