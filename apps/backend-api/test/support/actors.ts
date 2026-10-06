// An Actor for a route test that is not testing authentication. T-031 made `resolveActor` the only
// way a handler learns who is calling, and the principal — not the `key` string — is what handlers
// read, so a test standing in for identity has to supply a whole one. Everything but `userId` is a
// plausible default; a test that cares about a field passes it.
import { randomUUID } from 'node:crypto';
import { ANONYMOUS_ACTOR, actorFor, type Actor, type Principal } from '../../src/platform/http/principal.js';

export const testPrincipal = (userId: string, overrides: Partial<Principal> = {}): Principal => ({
  userId,
  publicId: `pub_${userId.slice(0, 8)}`,
  sessionId: randomUUID(),
  familyId: randomUUID(),
  scope: 'CONSUMER',
  status: 'ACTIVE',
  sessionsEpoch: 0,
  amr: ['pwd'],
  roles: [],
  permissions: new Set<string>(),
  companyMembership: null,
  ...overrides,
});

export const testActor = (userId: string, overrides: Partial<Principal> = {}): Actor =>
  actorFor(testPrincipal(userId, overrides));

export { ANONYMOUS_ACTOR };
