// M17 section 6 as HTTP. Each write does the same three things before the service runs: requires a
// STAFF principal, requires a reason (400 without one, as identity's admin surface does), and hands
// the caller's session over for the audit row. After the commit it drops the cache key, so the next
// read on this instance sees the change at once; other instances are covered by the event subscriber.
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import type { ConfigAccessor } from '../services/accessor.js';
import {
  changeFlag,
  changeSetting,
  listChangeLog,
  listFlags,
  listSettings,
  type ConfigActor,
  type Pagination,
} from '../services/settings.service.js';

export interface ConfigHttpDeps {
  db: () => Db;
  accessor: () => ConfigAccessor;
}

const MAX_REASON_LENGTH = 1000;

/** The body or query member wins over `X-Admin-Reason`; whitespace counts as missing. */
export function requireReason(req: Request, reason: string | undefined): string {
  const trimmed = (reason ?? req.get('x-admin-reason') ?? '').trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The reason is too long', undefined, [
      { path: 'reason', message: `At most ${MAX_REASON_LENGTH} characters` },
    ]);
  }
  if (trimmed.length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'A reason is required', 'Say why you are doing this', [
      { path: 'reason', message: 'Required' },
    ]);
  }
  return trimmed;
}

export function configActor(actor: Actor, req: Request): ConfigActor {
  return {
    userId: requireUserId(actor, 'Sign in with a staff session'),
    sessionId: actor.principal?.sessionId,
    ip: req.ip !== undefined && isIP(req.ip) ? req.ip : null,
    userAgent: req.get('user-agent') ?? null,
  };
}

interface Ctx {
  actor: Actor;
  req: Request;
}

export const settingsHandler = (deps: ConfigHttpDeps, namespace: string, page: Pagination) =>
  listSettings(deps.db(), namespace, page);

export async function putSettingHandler(
  deps: ConfigHttpDeps,
  { actor, req }: Ctx,
  params: { namespace: string; key: string },
  body: { value: unknown; reason?: string | undefined },
) {
  const staff = configActor(actor, req);
  const reason = requireReason(req, body.reason);
  const { setting } = await changeSetting(deps.db(), { actor: staff, ...params, value: body.value, reason });
  await deps.accessor().invalidateSetting(params.namespace, params.key);
  return setting;
}

export const flagsHandler = (deps: ConfigHttpDeps, page: Pagination) => listFlags(deps.db(), page);

export async function putFlagHandler(
  deps: ConfigHttpDeps,
  { actor, req }: Ctx,
  code: string,
  body: {
    enabled: boolean;
    rolloutNote?: string | null | undefined;
    description?: string | undefined;
    reason?: string | undefined;
  },
) {
  const staff = configActor(actor, req);
  const reason = requireReason(req, body.reason);
  const { flag } = await changeFlag(deps.db(), {
    actor: staff,
    code,
    enabled: body.enabled,
    rolloutNote: body.rolloutNote,
    description: body.description,
    reason,
  });
  await deps.accessor().invalidateFlag(code);
  return flag;
}

export const changeLogHandler = (
  deps: ConfigHttpDeps,
  query: Pagination & { target?: 'SETTING' | 'FLAG' | undefined; subject?: string | undefined },
) => listChangeLog(deps.db(), query);
