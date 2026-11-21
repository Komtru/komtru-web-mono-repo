// F-065: a pending invitation becomes an INVITED membership only when the invitee proves the very address
// it was filed under, and a recycled phone is never linked. The listener is subscribed to a recording
// bus, and the events it handles are the ones identity's own verification wrote to the outbox, so the
// handlers run exactly as the worker runs them: one transaction per event. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EventBus, EventSubscription } from '../../../src/platform/events/bus.js';
import type { Tx } from '../../../src/platform/events/publish.js';
import { subscribeToIdentity } from '../../../src/modules/logistics/infrastructure/identityListener.js';
import {
  attachEmail,
  attachPhone,
  markEmailVerified,
  markPhoneVerified,
} from '../../../src/modules/identity/services/contact.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, redisReady, seedUser } from '../identity/support.js';
import { bodyOf, seedCatalogue, seedMember, type Page } from '../identity/http/staff.support.js';
import {
  buildLogisticsApp,
  insertCompany,
  insertMember,
  logisticsSession,
  type LogisticsApp,
} from './support.js';

describe.runIf(infraEnabled)('logistics invitations through the identity listener (F-065)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let built: LogisticsApp;
  let app: Express;
  let subscriptions: EventSubscription[];
  /** Outbox rows already handed to a handler, so each event is delivered once per call to `deliver`. */
  let delivered: Set<number>;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    built = buildLogisticsApp(t, redis);
    app = built.app;
    subscriptions = [];
    delivered = new Set();
    const recorder = {
      subscribe: (subscription: EventSubscription) => subscriptions.push(subscription),
    } as unknown as EventBus;
    subscribeToIdentity(recorder, () => built.crypto.hasher);
  });
  afterAll(() => {
    redis?.disconnect();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Runs every subscriber of `eventType` over the outbox rows it has not seen, as the bus would. */
  async function deliver(eventType: string, { redeliver = false } = {}): Promise<number> {
    const { rows } = await t
      .app()
      .query<{ seq: number; event_id: string; payload: unknown; version: number }>(
        `SELECT seq, event_id, payload, version FROM platform.outbox WHERE event_type = $1 ORDER BY seq`,
        [eventType],
      );
    let handled = 0;
    for (const row of rows) {
      if (!redeliver && delivered.has(row.seq)) continue;
      delivered.add(row.seq);
      for (const subscription of subscriptions.filter((s) => s.event.eventType === eventType)) {
        const payload = subscription.event.payload.parse(row.payload);
        await t.db().transaction(async (tx: Tx) => {
          await subscription.handler({ eventId: row.event_id, eventType, payload } as never, tx);
        });
        handled += 1;
      }
    }
    return handled;
  }

  /** Everything written so far (the admin's own sign-up, say) is setup, not a delivery under test. */
  async function markSeen(): Promise<void> {
    const { rows } = await t.app().query<{ seq: number }>(`SELECT seq FROM platform.outbox`);
    for (const row of rows) delivered.add(row.seq);
  }

  async function companyWithAdmin() {
    const companyId = await insertCompany(t, 'Swift Couriers');
    const admin = await seedMember(t, app);
    await insertMember(t, { companyId, userId: admin.userId, role: 'ADMIN', status: 'ACTIVE' });
    const token = await logisticsSession(app, admin.email);
    await markSeen();
    return { companyId, token };
  }

  const invite = (token: string, contact: { email: string } | { phone: string }) =>
    request(app)
      .post('/v1/logistics/members')
      .set(bearer(token))
      .send({ ...contact, role: 'OPERATOR' });

  const membersOf = async (userId: string): Promise<{ company_id: string; status: string; role: string }[]> =>
    (
      await t.app().query<{ company_id: string; status: string; role: string }>(
        `SELECT company_id, status::text AS status, role::text AS role
             FROM logistics.logistics_company_members WHERE user_id = $1`,
        [userId],
      )
    ).rows;

  const invitationStatuses = async (token: string): Promise<string[]> =>
    bodyOf<Page<{ status: string }>>(
      await request(app).get('/v1/logistics/invitations').set(bearer(token)),
    ).items.map((item) => item.status);

  const verifyEmail = (userId: string, email: string) =>
    t.db().transaction(async (tx) => {
      const attached = await attachEmail(tx, { userId, email });
      await markEmailVerified(tx, { userId, emailId: attached.emailId, source: 'otp' });
    });

  const verifyPhone = (userId: string, phone: string) =>
    t.db().transaction(async (tx) => {
      const attached = await attachPhone(tx, { userId, phone });
      await markPhoneVerified(tx, { userId, phoneId: attached.phoneId });
    });

  describe('by email', () => {
    it('attaches nothing for a different verified address, then an INVITED membership for the invited one', async () => {
      const { companyId, token } = await companyWithAdmin();
      const invitedEmail = `courier-${randomUUID().slice(0, 8)}@example.com`;
      const pending = await invite(token, { email: invitedEmail });
      expect(pending.status).toBe(201);
      expect(pending.body).toMatchObject({ outcome: 'PENDING' });

      const { userId } = await seedUser(t.app());

      await verifyEmail(userId, `someone-else-${randomUUID().slice(0, 8)}@example.com`);
      expect(await deliver('identity.email.verified')).toBe(1);
      expect(await membersOf(userId)).toEqual([]);
      expect(await invitationStatuses(token)).toEqual(['PENDING']);

      await verifyEmail(userId, invitedEmail);
      expect(await deliver('identity.email.verified')).toBe(1);
      expect(await membersOf(userId)).toEqual([
        { company_id: companyId, status: 'INVITED', role: 'OPERATOR' },
      ]);
      expect(await invitationStatuses(token)).toEqual(['ACCEPTED']);

      // A further, unrelated address changes nothing, and neither does a redelivery of the first event.
      await verifyEmail(userId, `third-${randomUUID().slice(0, 8)}@example.com`);
      await deliver('identity.email.verified');
      await deliver('identity.email.verified', { redeliver: true });
      expect(await membersOf(userId)).toHaveLength(1);
    });

    it('does not let a phone verification attach an invitation filed under an email', async () => {
      const { token } = await companyWithAdmin();
      const invitedEmail = `courier-${randomUUID().slice(0, 8)}@example.com`;
      await invite(token, { email: invitedEmail });
      const { userId } = await seedUser(t.app());
      await verifyPhone(userId, '08035550111');
      expect(await deliver('identity.phone.verified')).toBe(1);
      expect(await membersOf(userId)).toEqual([]);
      expect(await invitationStatuses(token)).toEqual(['PENDING']);
    });
  });

  describe('by phone', () => {
    it('attaches nothing for a different verified number, then an INVITED membership for the invited one', async () => {
      const { companyId, token } = await companyWithAdmin();
      const pending = await invite(token, { phone: '08031234567' });
      expect(pending.status).toBe(201);
      expect(pending.body).toMatchObject({ outcome: 'PENDING' });

      const { userId } = await seedUser(t.app());

      await verifyPhone(userId, '08039998888');
      expect(await deliver('identity.phone.verified')).toBe(1);
      expect(await membersOf(userId)).toEqual([]);
      expect(await invitationStatuses(token)).toEqual(['PENDING']);

      await verifyPhone(userId, '08031234567');
      expect(await deliver('identity.phone.verified')).toBe(1);
      expect(await membersOf(userId)).toEqual([
        { company_id: companyId, status: 'INVITED', role: 'OPERATOR' },
      ]);
      expect(await invitationStatuses(token)).toEqual(['ACCEPTED']);
    });

    it('does not let an email verification attach an invitation filed under a phone', async () => {
      const { token } = await companyWithAdmin();
      await invite(token, { phone: '08031234567' });
      const { userId } = await seedUser(t.app());
      await verifyEmail(userId, `courier-${randomUUID().slice(0, 8)}@example.com`);
      await deliver('identity.email.verified');
      expect(await membersOf(userId)).toEqual([]);
    });
  });

  describe('a recycled phone', () => {
    const phone = '08031234567';

    it('is not linked once its reverify_after has passed: the invitation stays PENDING', async () => {
      const { token } = await companyWithAdmin();
      const { userId } = await seedUser(t.app());
      await verifyPhone(userId, phone);
      await t
        .owner()
        .query(
          `UPDATE identity.user_phones SET reverify_after = now() - interval '1 day' WHERE user_id = $1`,
          [userId],
        );

      const response = await invite(token, { phone });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ outcome: 'PENDING' });
      expect(response.body).not.toHaveProperty('member');
      expect(await membersOf(userId)).toEqual([]);
      expect(await invitationStatuses(token)).toEqual(['PENDING']);
    });

    it('is linked while the verification is current, so the stale case above is the only difference', async () => {
      const { companyId, token } = await companyWithAdmin();
      const { userId } = await seedUser(t.app());
      await verifyPhone(userId, phone);
      const { rows } = await t
        .app()
        .query<{ stale: boolean }>(
          `SELECT reverify_after <= now() AS stale FROM identity.user_phones WHERE user_id = $1`,
          [userId],
        );
      expect(rows[0]?.stale).toBe(false);

      const response = await invite(token, { phone });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ outcome: 'LINKED', member: { status: 'INVITED' } });
      expect(await membersOf(userId)).toEqual([
        { company_id: companyId, status: 'INVITED', role: 'OPERATOR' },
      ]);
    });
  });
});
