// The §10.4 route declarations: scopes, limits, schemas and the two deliberate deviations from the
// registry's defaults. Nothing here calls a handler — `assertRouteInvariants` reads definitions.
import { describe, expect, it } from 'vitest';
import type { Db } from '../../../../src/db/index.js';
import { NO_LOOKUP_BUDGET } from '../../../../src/modules/identity/infrastructure/redis/lookup-budget.js';
import { partyRoutes } from '../../../../src/modules/identity/http/routes/party.routes.js';
import type { PartyControllerDeps } from '../../../../src/modules/identity/http/controllers/party.controller.js';
import {
  inviteBodySchema,
  lookupBodySchema,
  suggestQuerySchema,
} from '../../../../src/modules/identity/http/validations/party.validation.js';
import { assertRouteInvariants, routeLabel } from '../../../../src/platform/http/route.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { testLogger } from '../support.js';

const stubDeps = (): PartyControllerDeps => ({
  db: null as unknown as Db,
  budget: NO_LOOKUP_BUDGET,
  hasher: createHmacHasher('pepper-for-route-declarations'),
  encryption: null as never,
  logger: testLogger,
});

const routes = partyRoutes(stubDeps());
const route = (label: string) => routes.find((candidate) => routeLabel(candidate) === label);

describe('party routes (M1 §10.4)', () => {
  it('declares every route §10.4 lists', () => {
    expect(routes.map(routeLabel).sort()).toEqual([
      'GET /parties/invitations/:token',
      'GET /parties/lookup',
      'GET /parties/suggest',
      'POST /parties/invite',
      'POST /parties/lookup',
    ]);
  });

  it('passes the registry invariants', () => {
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
  });

  it('requires a consumer session on everything that can resolve a person', () => {
    const scopes = Object.fromEntries(routes.map((r) => [routeLabel(r), r.scope]));
    expect(scopes).toEqual({
      'GET /parties/lookup': 'CONSUMER',
      'POST /parties/lookup': 'CONSUMER',
      'GET /parties/suggest': 'CONSUMER',
      'POST /parties/invite': 'CONSUMER',
      // The only PUBLIC one: its audience has no account, and the 256-bit token is the credential.
      'GET /parties/invitations/:token': 'PUBLIC',
    });
  });

  it('limits every lookup route per user, per device and per IP (M1 §17)', () => {
    for (const label of [
      'GET /parties/lookup',
      'POST /parties/lookup',
      'GET /parties/suggest',
      'POST /parties/invite',
    ]) {
      expect([...(route(label)?.rateLimit?.by ?? [])].sort()).toEqual(['device', 'ip', 'user']);
    }
  });

  it('charges an email or phone lookup more tightly than a handle lookup (§8.3 control 3)', () => {
    expect(route('POST /parties/lookup')?.rateLimit?.points).toBe(10);
    expect(route('GET /parties/lookup')?.rateLimit?.points).toBe(30);
  });

  it('leaves the per-IP window loose, because one Nigerian IP is thousands of subscribers', () => {
    expect(route('POST /parties/lookup')?.rateLimit?.perKey?.ip?.points).toBe(60);
    expect(route('GET /parties/lookup')?.rateLimit?.perKey?.ip?.points).toBe(120);
  });

  it('takes the email and the phone in the body and never in a query string (§S12)', () => {
    expect(route('POST /parties/lookup')?.schema.body).toBeDefined();
    for (const candidate of routes) {
      const query = candidate.schema.query;
      if (!query) continue;
      const shape = Object.keys((query as unknown as { shape: Record<string, unknown> }).shape ?? {});
      expect(shape).not.toContain('email');
      expect(shape).not.toContain('phone');
    }
  });

  it('declares no pagination on the typeahead, deliberately (§8.4)', () => {
    // A cursor or a page number would hand back the namespace walk the prefix rule removes.
    expect(route('GET /parties/suggest')?.paginated).toBeUndefined();
  });

  it('does not make a lookup replayable, so every probe reaches Risk (§8.3 control 6)', () => {
    expect(route('POST /parties/lookup')?.retryable).toBe(false);
  });

  it('does not make an invite replayable, so the claim token never reaches the idempotency table', () => {
    // The gate stores a completed response as plaintext jsonb for 24 hours, and this response
    // carries a live secret.
    expect(route('POST /parties/invite')?.retryable).toBe(false);
  });
});

describe('party request bodies', () => {
  it('rejects a lookup naming both an email and a phone', () => {
    expect(lookupBodySchema.safeParse({ email: 'a@b.com', phone: '08023415567' }).success).toBe(false);
  });

  it('rejects a lookup naming neither', () => {
    expect(lookupBodySchema.safeParse({}).success).toBe(false);
  });

  it('accepts exactly one of them, with an optional fingerprint', () => {
    expect(lookupBodySchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
    expect(
      lookupBodySchema.safeParse({ phone: '08023415567', deviceFingerprint: 'x'.repeat(12) }).success,
    ).toBe(true);
  });

  it('rejects an unknown field on every body', () => {
    expect(lookupBodySchema.safeParse({ email: 'a@b.com', userId: 'x' }).success).toBe(false);
    expect(
      inviteBodySchema.safeParse({
        channel: 'EMAIL',
        destination: 'a@b.com',
        intendedRole: 'BUYER',
        claimNow: true,
      }).success,
    ).toBe(false);
  });

  it('refuses an invitation naming a role that is not a trade side', () => {
    expect(
      inviteBodySchema.safeParse({ channel: 'EMAIL', destination: 'a@b.com', intendedRole: 'MERCHANT' })
        .success,
    ).toBe(false);
  });

  it('accepts a short typeahead query, leaving the three-character rule to the service', () => {
    expect(suggestQuerySchema.safeParse({ q: 'ja' }).success).toBe(true);
  });
});
