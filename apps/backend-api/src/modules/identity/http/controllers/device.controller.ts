// §10.5's device registry and session list, as HTTP.
//
// Devices and sessions share a file because they share a screen: "where am I signed in" and "which
// phones does this account know" are one question the user asks, and the two tables answer halves
// of it.
//
// Nothing here returns 403 for a row that is not the caller's. Every service call is scoped by
// `user_id`, so another user's id is a MISS and the answer is 404 — a 403 would confirm the row
// exists, which turns a uuid a client controls into a cross-account existence oracle.
import type { Request } from 'express';
import type { z } from 'zod';
import type { Db } from '../../../../db/index.js';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import type { Logger } from '../../../../platform/logger.js';
import { publish } from '../../../../platform/events/publish.js';
import { identityDeviceRegisteredEvent } from '../../domain/events.js';
import { AUDIT_ACTIONS, writeAudit } from '../../services/audit.service.js';
import {
  fingerprintDigest,
  listDevices,
  registerDevice,
  retireDevice,
  trustDevice,
  type DeviceView,
} from '../../services/device.service.js';
import { listSessions, revokeSession } from '../../services/session.service.js';
import type { registerDeviceRequestSchema } from '../validations/device.validation.js';
import { callerAgent, callerIp } from './request.js';

export interface DeviceControllerDeps {
  db: Db;
  logger: Logger;
}

const MANAGE_DEVICES = 'Sign in to manage your devices';
const MANAGE_SESSIONS = 'Sign in to see where you are signed in';

const notFound = (what: string): ApiError =>
  new ApiError(404, 'NOT_FOUND', `That ${what} is not on your account`);

export async function postDevice(
  deps: DeviceControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof registerDeviceRequestSchema>,
): Promise<DeviceView> {
  const userId = requireUserId(actor, MANAGE_DEVICES);
  const ip = callerIp(req);

  return deps.db.transaction(async (tx) => {
    const { device, isNewDevice } = await registerDevice(tx, {
      userId,
      fingerprint: body.deviceFingerprint,
      platform: body.platform ?? null,
      osVersion: body.osVersion ?? null,
      appVersion: body.appVersion ?? null,
      model: body.model ?? null,
      pushToken: body.pushToken ?? null,
      ip,
    });

    // Only on the first sighting. Risk wants the arrival of a handset, not a heartbeat every launch.
    if (isNewDevice) {
      await publish(tx, identityDeviceRegisteredEvent, {
        payload: {
          userId,
          deviceId: device.id,
          fingerprintHash: fingerprintDigest(body.deviceFingerprint),
          platform: device.platform,
          hasPushToken: device.hasPushToken,
        },
        aggregateType: 'identity.device',
        aggregateId: device.id,
        actor: { type: 'CONSUMER', id: userId },
      });

      await writeAudit(tx, {
        action: AUDIT_ACTIONS.DEVICE_REGISTERED,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        ip,
        userAgent: callerAgent(req),
        deviceId: device.id,
        metadata: { platform: device.platform, hasPushToken: device.hasPushToken },
      });
    }

    return device;
  });
}

export async function getDevices(
  deps: DeviceControllerDeps,
  actor: Actor,
  query: { page?: number; limit?: number },
) {
  const userId = requireUserId(actor, MANAGE_DEVICES);
  return listDevices(deps.db, { userId, page: query.page ?? 1, limit: query.limit ?? 20 });
}

export async function deleteDevice(
  deps: DeviceControllerDeps,
  req: Request,
  actor: Actor,
  params: { id: string },
): Promise<{ ok: true }> {
  const userId = requireUserId(actor, MANAGE_DEVICES);
  const ip = callerIp(req);

  const removed = await deps.db.transaction(async (tx) => {
    const ok = await retireDevice(tx, { userId, deviceId: params.id });
    if (ok) {
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.DEVICE_RETIRED,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        ip,
        userAgent: callerAgent(req),
        deviceId: params.id,
      });
    }
    return ok;
  });

  if (!removed) throw notFound('device');
  return { ok: true };
}

export async function postDeviceTrust(
  deps: DeviceControllerDeps,
  req: Request,
  actor: Actor,
  params: { id: string },
): Promise<{ ok: true }> {
  const userId = requireUserId(actor, MANAGE_DEVICES);
  const ip = callerIp(req);

  const trusted = await deps.db.transaction(async (tx) => {
    const ok = await trustDevice(tx, { userId, deviceId: params.id });
    if (ok) {
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.DEVICE_TRUSTED,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        ip,
        userAgent: callerAgent(req),
        deviceId: params.id,
      });
    }
    return ok;
  });

  if (!trusted) throw notFound('device');
  return { ok: true };
}

export async function getSessions(
  deps: DeviceControllerDeps,
  actor: Actor,
  query: { page?: number; limit?: number },
) {
  const userId = requireUserId(actor, MANAGE_SESSIONS);
  return listSessions(deps.db, {
    userId,
    // Off the resolved principal, never off `actor.key`: the principal is re-read from Postgres
    // every request (T-031), and `key` is a storage string for the idempotency and limiter tables.
    currentSessionId: actor.principal?.sessionId ?? null,
    page: query.page ?? 1,
    limit: query.limit ?? 20,
  });
}

export async function deleteSession(
  deps: DeviceControllerDeps,
  req: Request,
  actor: Actor,
  params: { id: string },
): Promise<{ ok: true }> {
  const userId = requireUserId(actor, MANAGE_SESSIONS);

  const revoked = await deps.db.transaction(async (tx) => {
    const ok = await revokeSession(tx, { userId, sessionId: params.id, reason: 'revoked_by_user' });
    if (ok) {
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.SESSION_REVOKED,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        ip: callerIp(req),
        userAgent: callerAgent(req),
        sessionId: params.id,
        metadata: { reason: 'revoked_by_user' },
      });
    }
    return ok;
  });
  if (!revoked) throw notFound('session');

  return { ok: true };
}
