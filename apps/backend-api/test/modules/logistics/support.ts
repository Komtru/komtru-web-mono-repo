// Shared setup for T-086's integration tests: identity's routes and the logistics routes mounted on one
// app, with the two ports wired exactly as the registry wires them, so every session in these tests is
// opened by the real sign-in routes rather than a hand-built token.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import { logisticsRoutes } from '../../../src/modules/logistics/http/routes.js';
import { acceptOnLogin, activeMembership, hasLogisticsAccess } from '../../../src/modules/logistics/index.js';
import type { LogisticsCrypto } from '../../../src/modules/logistics/services/member.service.js';
import { createEncryption } from '../../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import { createIdempotencyGate } from '../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../src/platform/http/rateLimit.js';
import type { TestDatabase } from '../../support/db.js';
import { testConfig, testLogger } from '../identity/support.js';
import { PASSWORD, bodyOf, type SessionBody } from '../identity/http/staff.support.js';

export interface LogisticsApp {
  app: Express;
  crypto: LogisticsCrypto;
}

export function buildLogisticsApp(t: TestDatabase, redis: Redis): LogisticsApp {
  const config = testConfig({ WEBAUTHN_ORIGINS: 'https://app.komtru.test' });
  const crypto: LogisticsCrypto = {
    hasher: createHmacHasher(config.identity.hmacPepper ?? ''),
    encryption: createEncryption(config),
  };
  const auth = createIdentityAuth({
    db: t.db(),
    redis,
    config,
    logger: testLogger,
    companyMembership: activeMembership,
    logisticsAccess: { eligible: hasLogisticsAccess, accept: acceptOnLogin },
  });
  const routes = [...(auth.routes ?? []), ...logisticsRoutes({ db: () => t.db(), crypto: () => crypto })];
  const app = createApp({
    config,
    logger: testLogger,
    mountV1: mountRoutes(routes, {
      logger: testLogger,
      idempotency: createIdempotencyGate({ db: t.db(), redis, logger: testLogger }),
      rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `rl-${randomUUID()}` }),
      resolveActor: auth.resolveActor,
      onDenied: auth.onAccessDenied,
    }),
  });
  return { app, crypto };
}

export const logisticsLogin = (app: Express, email: string, password = PASSWORD) =>
  request(app).post('/v1/auth/logistics/login').send({ identifier: email, password });

/** The whole logistics sign-in for an account with no second factor. */
export async function logisticsSession(app: Express, email: string): Promise<string> {
  const response = await logisticsLogin(app, email);
  expect(response.status).toBe(200);
  expect(bodyOf<SessionBody>(response).scope).toBe('LOGISTICS');
  return bodyOf<SessionBody>(response).accessToken;
}

export async function consumerSession(app: Express, email: string): Promise<string> {
  const response = await request(app).post('/v1/auth/login').send({ identifier: email, password: PASSWORD });
  expect(response.status).toBe(200);
  return bodyOf<SessionBody>(response).accessToken;
}

export async function insertCompany(t: TestDatabase, name: string): Promise<string> {
  const { rows } = await t
    .app()
    .query<{ id: string }>(`INSERT INTO logistics.logistics_companies (name) VALUES ($1) RETURNING id`, [
      name,
    ]);
  return rows[0]!.id;
}

export async function insertMember(
  t: TestDatabase,
  input: { companyId: string; userId: string; role?: string; status?: string },
): Promise<string> {
  const { rows } = await t.app().query<{ id: string }>(
    `INSERT INTO logistics.logistics_company_members (company_id, user_id, role, status)
     VALUES ($1, $2, $3::logistics.member_role, $4::logistics.member_status) RETURNING id`,
    [input.companyId, input.userId, input.role ?? 'ADMIN', input.status ?? 'INVITED'],
  );
  return rows[0]!.id;
}

export const memberStatus = async (t: TestDatabase, memberId: string): Promise<string | undefined> =>
  (
    await t
      .app()
      .query<{ status: string }>(
        `SELECT status::text AS status FROM logistics.logistics_company_members WHERE id = $1`,
        [memberId],
      )
  ).rows[0]?.status;
