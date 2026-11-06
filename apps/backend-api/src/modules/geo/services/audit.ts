// Every staff change to the catalog is one transaction holding the row, the admin action row
// (identity's audit log, until M14's own exists) and the outbox event. A change that cannot be
// explained afterwards does not happen.
import type { Tx } from '../../../platform/events/publish.js';
import { writeAudit } from '../../identity/index.js';

export const GEO_AUDIT = {
  CITY_ADDED: 'ADMIN_GEO_CITY_ADDED',
  CITY_UPDATED: 'ADMIN_GEO_CITY_UPDATED',
  CITY_DEACTIVATED: 'ADMIN_GEO_CITY_DEACTIVATED',
  CITY_ACTIVATED: 'ADMIN_GEO_CITY_ACTIVATED',
  REQUEST_ADDED: 'ADMIN_GEO_CITY_REQUEST_ADDED',
  REQUEST_MERGED: 'ADMIN_GEO_CITY_REQUEST_MERGED',
  REQUEST_REJECTED: 'ADMIN_GEO_CITY_REQUEST_REJECTED',
} as const;

export interface GeoActor {
  userId: string;
  sessionId?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
}

export const staffActorEvent = (actor: GeoActor) => ({ type: 'STAFF' as const, id: actor.userId });

export const writeGeoAudit = (
  tx: Tx,
  actor: GeoActor,
  action: (typeof GEO_AUDIT)[keyof typeof GEO_AUDIT],
  metadata: Record<string, unknown>,
) =>
  writeAudit(tx, {
    action,
    outcome: 'SUCCESS',
    actorType: 'STAFF',
    actorUserId: actor.userId,
    sessionId: actor.sessionId ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    metadata,
  });
