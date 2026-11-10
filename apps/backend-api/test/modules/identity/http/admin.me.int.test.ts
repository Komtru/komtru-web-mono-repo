// F-051: `GET /admin/me`, the route the TrustOps console reads to learn who is signed in and what it
// may show. Skipped unless KOMTRU_INFRA_TESTS=1.
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { permissionsForRole } from '../../../../src/modules/identity/domain/rbac/catalog.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady } from '../support.js';
import { PASSWORD, bodyOf, buildApp, seedCatalogue, seedMember, staffSession } from './staff.support.js';

interface Me {
  user: { id: string; publicId: string; displayName: string | null; username: string | null };
  roles: { code: string; name: string }[];
  permissions: string[];
}

describe.runIf(infraEnabled)('GET /admin/me (F-051)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    app = buildApp(t, redis);
  });
  afterAll(() => {
    redis?.disconnect();
  });

  it('tells a staff member who they are, their live roles and the permissions those roles hold', async () => {
    const member = await seedMember(t, app, { roles: ['KYC_ANALYST'], mfa: true });
    const token = await staffSession(app, member);
    await t.owner().query(
      `INSERT INTO identity.user_profiles (user_id, display_name) VALUES ($1, 'Amina Yusuf')
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [member.userId],
    );

    const response = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const me = bodyOf<Me>(response);
    expect(me.user.id).toBe(member.userId);
    expect(me.user.displayName).toBe('Amina Yusuf');
    expect(me.roles).toEqual([{ code: 'KYC_ANALYST', name: expect.any(String) as string }]);
    expect(me.permissions).toContain('verification.view');
    expect(me.permissions).toContain('verification.review');
    // Only what the role is granted: nothing a KYC analyst is denied is offered to the console.
    expect(me.permissions).not.toContain('payment.refund');
    for (const code of me.permissions) expect(typeof code).toBe('string');
    expect(permissionsForRole('KYC_ANALYST').length).toBeGreaterThan(0);
  });

  it('refuses a consumer session (403) and no session (401)', async () => {
    const member = await seedMember(t, app);
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: member.email, password: PASSWORD });
    const consumerToken = bodyOf<{ accessToken: string }>(login).accessToken;
    expect(
      (await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${consumerToken}`)).status,
    ).toBe(403);
    expect((await request(app).get('/v1/admin/me')).status).toBe(401);
  });
});
