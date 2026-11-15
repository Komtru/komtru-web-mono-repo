// T-055's HTTP layer: turn a request into a service call. Every staff handler does the same three things
// before it calls one: it requires a STAFF principal, it requires a REASON where the action changes
// something (a 400 without one, M1 section 10.6), and it hands over the caller's live roles and
// session. The services write the log, the audit rows and the events, so a route cannot forget to.
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import type { Logger } from '../../../platform/logger.js';
import {
  getMyApplication,
  saveDraft,
  submitApplication,
  type SubmitMode,
} from '../services/application.service.js';
import {
  assignApplication,
  countAwaitingReview,
  decideApplication,
  getApplicationDetail,
  listApplications,
  type StaffActor,
} from '../services/review.service.js';
import type { MerchantPorts } from '../services/ports.js';
import type { approveBody, draftBody, queueQuery, rejectBody, requestChangesBody } from './validations.js';

export interface MerchantHttpDeps {
  db: () => Db;
  ports: () => MerchantPorts;
  logger: () => Logger;
}

interface Ctx {
  actor: Actor;
  req: Request;
}

const MAX_REASON_LENGTH = 1000;
const SIGN_IN_STAFF = 'Sign in with a staff session';
const SIGN_IN_APPLY = 'Sign in to apply for merchant certification';

const applicationDeps = (deps: MerchantHttpDeps) => ({
  db: deps.db(),
  ports: deps.ports(),
  logger: deps.logger(),
});

// --- applicant ---------------------------------------------------------------------------------

export const myApplicationHandler = (deps: MerchantHttpDeps, { actor }: Ctx) =>
  getMyApplication(deps.db(), requireUserId(actor, SIGN_IN_APPLY));

export const saveDraftHandler = (deps: MerchantHttpDeps, { actor }: Ctx, body: z.output<typeof draftBody>) =>
  saveDraft(applicationDeps(deps), requireUserId(actor, SIGN_IN_APPLY), {
    ...(body.businessName === undefined ? {} : { businessName: body.businessName }),
    ...(body.businessType === undefined ? {} : { businessType: body.businessType }),
    ...(body.addressLine === undefined ? {} : { addressLine: body.addressLine }),
    ...(body.stateId === undefined ? {} : { stateId: body.stateId }),
    ...(body.cityId === undefined ? {} : { cityId: body.cityId }),
    ...(body.categories === undefined ? {} : { categories: body.categories }),
    ...(body.cacRcNumber === undefined ? {} : { cacRcNumber: body.cacRcNumber }),
    ...(body.payoutAccountId === undefined ? {} : { payoutAccountId: body.payoutAccountId }),
    ...(body.documents === undefined ? {} : { documents: body.documents }),
  });

export const submitHandler = (
  deps: MerchantHttpDeps,
  { actor }: Ctx,
  applicationId: string,
  mode: SubmitMode,
) =>
  submitApplication(applicationDeps(deps), {
    userId: requireUserId(actor, SIGN_IN_APPLY),
    applicationId,
    mode,
  });

// --- staff -------------------------------------------------------------------------------------

/** The caller as the services want it, read off the principal built from the database this request. */
export function staffActor({ actor, req }: Ctx): StaffActor {
  return {
    userId: requireUserId(actor, SIGN_IN_STAFF),
    roles: actor.principal?.roles ?? [],
    sessionId: actor.principal?.sessionId,
    ip: req.ip !== undefined && isIP(req.ip) ? req.ip : null,
    userAgent: req.get('user-agent') ?? null,
  };
}

/** The body member wins over `X-Admin-Reason`; whitespace counts as missing. 400 without one. */
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

export const listHandler = (deps: MerchantHttpDeps, query: z.output<typeof queueQuery>) =>
  listApplications(deps.db(), {
    status: query.status,
    category: query.category,
    show: query.show,
    page: query.page,
    limit: query.limit,
  });

export const countHandler = (deps: MerchantHttpDeps) => countAwaitingReview(deps.db());

export const detailHandler = (deps: MerchantHttpDeps, ctx: Ctx, applicationId: string) =>
  getApplicationDetail(applicationDeps(deps), { applicationId, viewer: staffActor(ctx) });

export const assignHandler = (deps: MerchantHttpDeps, ctx: Ctx, applicationId: string) =>
  assignApplication(deps.db(), { actor: staffActor(ctx), applicationId });

export const approveHandler = (
  deps: MerchantHttpDeps,
  ctx: Ctx,
  applicationId: string,
  body: z.output<typeof approveBody>,
) =>
  decideApplication(deps.db(), {
    actor: staffActor(ctx),
    applicationId,
    decision: { outcome: 'APPROVE' },
    reason: requireReason(ctx.req, body.reason),
    policyCitation: body.policyCitation,
  });

export const rejectHandler = (
  deps: MerchantHttpDeps,
  ctx: Ctx,
  applicationId: string,
  body: z.output<typeof rejectBody>,
) =>
  decideApplication(deps.db(), {
    actor: staffActor(ctx),
    applicationId,
    decision: { outcome: 'REJECT' },
    reason: requireReason(ctx.req, body.reason),
    policyCitation: body.policyCitation,
  });

export const requestChangesHandler = (
  deps: MerchantHttpDeps,
  ctx: Ctx,
  applicationId: string,
  body: z.output<typeof requestChangesBody>,
) =>
  decideApplication(deps.db(), {
    actor: staffActor(ctx),
    applicationId,
    decision: {
      outcome: 'REQUEST_CHANGES',
      requested: body.requested.map((item) => ({
        kind: item.kind,
        key: item.key,
        ...(item.note === undefined ? {} : { note: item.note }),
      })),
    },
    reason: requireReason(ctx.req, body.reason),
    policyCitation: body.policyCitation,
  });
