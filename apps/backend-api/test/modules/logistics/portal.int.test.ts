// T-086 end to end over HTTP: logistics sign-in and login-is-acceptance, staff onboarding, the portal's
// team routes, and the scope and company isolation m2 §15 asks for. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { materialiseInvitations } from '../../../src/modules/logistics/services/invitation.service.js';
import { acceptOnLogin } from '../../../src/modules/logistics/services/access.service.js';
import { attachEmail, markEmailVerified } from '../../../src/modules/identity/services/contact.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, redisReady, seedUser } from '../identity/support.js';
import {
  bodyOf,
  seedCatalogue,
  seedMember,
  staffSession,
  type Page,
  type Problem,
} from '../identity/http/staff.support.js';
import {
  buildLogisticsApp,
  consumerSession,
  insertCompany,
  insertMember,
  logisticsLogin,
  logisticsSession,
  memberStatus,
  type LogisticsApp,
} from './support.js';

interface MemberBody {
  id: string;
  role: string;
  status: string;
  name: string | null;
  contactMasked: string | null;
}

describe.runIf(infraEnabled)('logistics portal (T-086)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let built: LogisticsApp;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    built = buildLogisticsApp(t, redis);
    app = built.app;
  });
  afterAll(() => {
    redis?.disconnect();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A company with one ACTIVE admin, signed in. */
  async function companyWithAdmin(name = 'Swift Couriers') {
    const companyId = await insertCompany(t, name);
    const admin = await seedMember(t, app);
    const memberId = await insertMember(t, { companyId, userId: admin.userId, role: 'ADMIN' });
    const token = await logisticsSession(app, admin.email);
    return { companyId, admin, memberId, token };
  }

  describe('sign-in', () => {
    it('answers 403 NO_LOGISTICS_ACCESS for a right password with no membership, and 401 otherwise', async () => {
      const person = await seedMember(t, app);
      const noAccess = await logisticsLogin(app, person.email);
      expect(noAccess.status).toBe(403);
      expect(bodyOf<Problem>(noAccess).code).toBe('NO_LOGISTICS_ACCESS');

      for (const response of [
        await logisticsLogin(app, person.email, 'not the password at all'),
        await logisticsLogin(app, 'nobody@example.com'),
      ]) {
        expect(response.status).toBe(401);
        expect(bodyOf<Problem>(response).code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('accepts the invitation on first sign-in (INVITED becomes ACTIVE) and opens a LOGISTICS session', async () => {
      const companyId = await insertCompany(t, 'Swift Couriers');
      const person = await seedMember(t, app);
      const memberId = await insertMember(t, { companyId, userId: person.userId, role: 'OPERATOR' });
      expect(await memberStatus(t, memberId)).toBe('INVITED');

      const token = await logisticsSession(app, person.email);
      expect(await memberStatus(t, memberId)).toBe('ACTIVE');

      const me = await request(app).get('/v1/logistics/me').set(bearer(token));
      expect(me.status).toBe(200);
      expect(bodyOf<{ company: { id: string }; member: { role: string } }>(me)).toMatchObject({
        company: { id: companyId },
        member: { id: memberId, role: 'OPERATOR' },
      });
    });

    it('keeps consumer sign-in a consumer session for the same account', async () => {
      const { admin } = await companyWithAdmin();
      const token = await consumerSession(app, admin.email);
      const portal = await request(app).get('/v1/logistics/members').set(bearer(token));
      expect(portal.status).toBe(403);
    });

    it('answers 409 ALREADY_HAS_ACTIVE_COMPANY to the loser of an activation race, leaving one ACTIVE row', async () => {
      const person = await seedMember(t, app);
      const a = await insertCompany(t, 'Courier A');
      const b = await insertCompany(t, 'Courier B');
      await insertMember(t, { companyId: b, userId: person.userId });

      // Another transaction is making this person ACTIVE at A and has not committed yet.
      const rival = await t.owner().connect();
      try {
        await rival.query('BEGIN');
        await rival.query(
          `INSERT INTO logistics.logistics_company_members (company_id, user_id, role, status)
             VALUES ($1, $2, 'OPERATOR', 'ACTIVE')`,
          [a, person.userId],
        );

        // This sign-in sees no ACTIVE row yet, takes its one invitation (B), and waits on the unique
        // index behind the rival.
        const loser = t.db().transaction((tx) => acceptOnLogin(tx, person.userId));
        await new Promise((resolve) => setTimeout(resolve, 200));
        await rival.query('COMMIT');

        await expect(loser).rejects.toMatchObject({ status: 409, code: 'ALREADY_HAS_ACTIVE_COMPANY' });
      } finally {
        rival.release();
      }
      const { rows } = await t
        .app()
        .query<{ company_id: string }>(
          `SELECT company_id FROM logistics.logistics_company_members WHERE user_id = $1 AND status = 'ACTIVE'`,
          [person.userId],
        );
      expect(rows.map((row) => row.company_id)).toEqual([a]);

      // Signing in again afterwards simply uses the winner.
      const token = await logisticsSession(app, person.email);
      const me = await request(app).get('/v1/logistics/me').set(bearer(token));
      expect(me.body).toMatchObject({ company: { id: a } });
    }, 20_000);

    it('accepts none of several invitations and answers 409 MULTIPLE_LOGISTICS_INVITATIONS', async () => {
      const person = await seedMember(t, app);
      const a = await insertMember(t, {
        companyId: await insertCompany(t, 'Courier A'),
        userId: person.userId,
      });
      const b = await insertMember(t, {
        companyId: await insertCompany(t, 'Courier B'),
        userId: person.userId,
      });
      const response = await logisticsLogin(app, person.email);
      expect(response.status).toBe(409);
      expect(bodyOf<Problem>(response).code).toBe('MULTIPLE_LOGISTICS_INVITATIONS');
      expect(await memberStatus(t, a)).toBe('INVITED');
      expect(await memberStatus(t, b)).toBe('INVITED');
      const { rows } = await t
        .app()
        .query(`SELECT 1 FROM identity.sessions WHERE user_id = $1 AND scope = 'LOGISTICS'`, [person.userId]);
      expect(rows).toHaveLength(0);
    });

    it('lets the same person sign in twice at once on one invitation: both succeed, one ACTIVE row', async () => {
      const companyId = await insertCompany(t, 'Swift Couriers');
      const person = await seedMember(t, app);
      const memberId = await insertMember(t, { companyId, userId: person.userId, role: 'OPERATOR' });
      const [first, second] = await Promise.all([
        logisticsLogin(app, person.email),
        logisticsLogin(app, person.email),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await memberStatus(t, memberId)).toBe('ACTIVE');
    });
  });

  describe('staff onboarding (m2 §5a)', () => {
    it('links an existing verified account, and files a pending invitation for anyone else', async () => {
      const staff = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
      const staffToken = await staffSession(app, staff);
      const poc = await seedMember(t, app);

      const linked = await request(app)
        .post('/v1/admin/logistics/companies')
        .set(bearer(staffToken))
        .send({ name: '  Swift   Couriers ', initialPoc: { email: poc.email } });
      expect(linked.status).toBe(201);
      expect(linked.body).toMatchObject({
        company: { name: 'Swift Couriers', status: 'ENABLED', isDefault: false },
        outcome: 'LINKED',
        member: { role: 'ADMIN', status: 'INVITED' },
      });

      const pending = await request(app)
        .post('/v1/admin/logistics/companies')
        .set(bearer(staffToken))
        .send({ name: 'Rapid Riders', initialPoc: { phone: '08031234567' } });
      expect(pending.status).toBe(201);
      expect(pending.body).toMatchObject({
        outcome: 'PENDING',
        invitation: { role: 'ADMIN', channel: 'PHONE', status: 'PENDING' },
      });
      // Never the number itself.
      expect(JSON.stringify(pending.body)).not.toContain('8031234567');

      const list = await request(app).get('/v1/admin/logistics/companies').set(bearer(staffToken));
      expect(bodyOf<Page<{ name: string }>>(list).items.map((c) => c.name)).toEqual([
        'Rapid Riders',
        'Swift Couriers',
      ]);
    });

    it('materialises a pending invitation once its invitee verifies the address, still INVITED', async () => {
      const { companyId: ownCompany, token } = await companyWithAdmin('Own Co');
      const email = `new-${randomUUID().slice(0, 8)}@example.com`;
      const invited = await request(app)
        .post('/v1/logistics/members')
        .set(bearer(token))
        .send({ email, role: 'OPERATOR' });
      expect(invited.status).toBe(201);
      expect(invited.body).toMatchObject({ outcome: 'PENDING' });

      // The invitee signs up the ordinary way and proves the address; the subscriber runs this.
      const { userId } = await seedUser(t.app());
      await t.db().transaction(async (tx) => {
        const attached = await attachEmail(tx, { userId, email, makePrimary: true });
        await markEmailVerified(tx, { userId, emailId: attached.emailId, source: 'otp' });
        expect(
          await materialiseInvitations(tx, built.crypto.hasher, {
            userId,
            channel: 'EMAIL',
            canonical: email,
          }),
        ).toBe(1);
      });

      const { rows } = await t.app().query<{ status: string; role: string }>(
        `SELECT status::text AS status, role::text AS role FROM logistics.logistics_company_members
            WHERE company_id = $1 AND user_id = $2`,
        [ownCompany, userId],
      );
      expect(rows).toEqual([{ status: 'INVITED', role: 'OPERATOR' }]);
      const invitations = await request(app).get('/v1/logistics/invitations').set(bearer(token));
      expect(bodyOf<Page<{ status: string }>>(invitations).items.map((i) => i.status)).toEqual(['ACCEPTED']);
    });
  });

  describe('the team (m2 §5b)', () => {
    it('invites a verified account as LINKED and refuses the same person twice', async () => {
      const { token } = await companyWithAdmin();
      const colleague = await seedMember(t, app);
      const first = await request(app)
        .post('/v1/logistics/members')
        .set(bearer(token))
        .send({ email: colleague.email, role: 'OPERATOR' });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        outcome: 'LINKED',
        member: { role: 'OPERATOR', status: 'INVITED' },
      });

      const again = await request(app)
        .post('/v1/logistics/members')
        .set(bearer(token))
        .send({ email: colleague.email, role: 'ADMIN' });
      expect(again.status).toBe(409);
      expect(bodyOf<Problem>(again).code).toBe('ALREADY_A_MEMBER');
    });

    it('answers 409 LAST_ADMIN for removing or demoting the only active admin', async () => {
      const { token, memberId } = await companyWithAdmin();
      for (const body of [{ status: 'REMOVED' }, { role: 'OPERATOR' }]) {
        const response = await request(app)
          .patch(`/v1/logistics/members/${memberId}`)
          .set(bearer(token))
          .send(body);
        expect(response.status).toBe(409);
        expect(bodyOf<Problem>(response).code).toBe('LAST_ADMIN');
      }
    });

    it('lets an operator read the roster and nothing more', async () => {
      const { companyId, memberId } = await companyWithAdmin();
      const operator = await seedMember(t, app);
      await insertMember(t, { companyId, userId: operator.userId, role: 'OPERATOR' });
      const token = await logisticsSession(app, operator.email);

      const roster = await request(app).get('/v1/logistics/members').set(bearer(token));
      expect(roster.status).toBe(200);
      expect(bodyOf<Page<MemberBody>>(roster).items).toHaveLength(2);

      for (const response of [
        await request(app)
          .post('/v1/logistics/members')
          .set(bearer(token))
          .send({ email: 'x@example.com', role: 'ADMIN' }),
        await request(app)
          .patch(`/v1/logistics/members/${memberId}`)
          .set(bearer(token))
          .send({ status: 'REMOVED' }),
      ]) {
        expect(response.status).toBe(403);
      }
    });

    it('removes a member without touching their account, and the removal bites on the next request', async () => {
      const { companyId, token } = await companyWithAdmin();
      const operator = await seedMember(t, app);
      const operatorMember = await insertMember(t, { companyId, userId: operator.userId, role: 'OPERATOR' });
      const operatorToken = await logisticsSession(app, operator.email);
      expect((await request(app).get('/v1/logistics/members').set(bearer(operatorToken))).status).toBe(200);

      const removed = await request(app)
        .patch(`/v1/logistics/members/${operatorMember}`)
        .set(bearer(token))
        .send({ status: 'REMOVED' });
      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({ status: 'REMOVED' });

      const after = await request(app).get('/v1/logistics/members').set(bearer(operatorToken));
      expect(after.status).toBe(403);
      expect(bodyOf<Problem>(after).code).toBe('NO_LOGISTICS_ACCESS');
      const { rows } = await t
        .app()
        .query<{ status: string }>(`SELECT status::text AS status FROM identity.users WHERE id = $1`, [
          operator.userId,
        ]);
      expect(rows[0]?.status).toBe('ACTIVE');
      expect((await consumerSession(app, operator.email)).length).toBeGreaterThan(0);
    });
  });

  describe('isolation (m2 §15)', () => {
    it('keeps every portal call inside the caller’s own company', async () => {
      const a = await companyWithAdmin('Courier A');
      const b = await companyWithAdmin('Courier B');

      const roster = await request(app)
        .get('/v1/logistics/members')
        .query({ companyId: b.companyId })
        .set(bearer(a.token));
      expect(bodyOf<Page<MemberBody>>(roster).items.map((m) => m.id)).toEqual([a.memberId]);

      const foreign = await request(app)
        .patch(`/v1/logistics/members/${b.memberId}`)
        .set(bearer(a.token))
        .send({ role: 'OPERATOR' });
      expect(foreign.status).toBe(404);
      expect(await memberStatus(t, b.memberId)).toBe('ACTIVE');

      const smuggled = await request(app)
        .post('/v1/logistics/members')
        .set(bearer(a.token))
        .send({ email: 'x@example.com', role: 'OPERATOR', companyId: b.companyId });
      expect(smuggled.status).toBe(422);
    });

    it('refuses a LOGISTICS token on STAFF and CONSUMER routes, and STAFF and CONSUMER tokens on the portal', async () => {
      const { token: logistics, admin } = await companyWithAdmin();
      const consumer = await consumerSession(app, admin.email);
      const staffMember = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
      const staff = await staffSession(app, staffMember);

      expect((await request(app).get('/v1/admin/logistics/companies').set(bearer(logistics))).status).toBe(
        403,
      );
      expect((await request(app).get('/v1/me/sessions').set(bearer(logistics))).status).toBe(403);
      expect((await request(app).get('/v1/logistics/members').set(bearer(consumer))).status).toBe(403);
      expect((await request(app).get('/v1/logistics/members').set(bearer(staff))).status).toBe(403);
      expect((await request(app).get('/v1/admin/logistics/companies').set(bearer(consumer))).status).toBe(
        403,
      );
      expect((await request(app).get('/v1/admin/logistics/companies').set(bearer(staff))).status).toBe(200);
    });

    it('refuses staff without logistics.manage', async () => {
      const staffMember = await seedMember(t, app, { roles: ['KYC_ANALYST'], mfa: true });
      const staff = await staffSession(app, staffMember);
      expect((await request(app).get('/v1/admin/logistics/companies').set(bearer(staff))).status).toBe(403);
    });
  });
});
