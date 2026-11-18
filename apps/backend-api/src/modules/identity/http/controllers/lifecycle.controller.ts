// T-039 as HTTP: `GET /me`, the close and NDPA routes, and account recovery. A thin layer; the rules
// are in lifecycle.service.ts, ndpa.service.ts and recovery.service.ts. This file resolves who is
// calling and where from, and nothing here logs a body (the close body carries a password).
import { desc, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import { maskEmail, maskPhone } from '../../../../platform/identifiers.js';
import { userEmails, userPhones } from '../../infrastructure/postgres/schema/contacts.js';
import { users } from '../../infrastructure/postgres/schema/users.js';
import { getAccountNotice, closeOwnAccount, type CloseInput } from '../../services/lifecycle.service.js';
import { requestDataExport, requestErasure, type NdpaDeps } from '../../services/ndpa.service.js';
import {
  decideRecovery,
  listRecoveryRequests,
  requestRecovery,
  type RecoveryDeps,
} from '../../services/recovery.service.js';
import type {
  closeAccountBody,
  recoveryDecisionBody,
  recoveryIntakeBody,
  recoveryQuery,
} from '../validations/lifecycle.validation.js';
import { requireReason, staffActor } from './admin.controller.js';
import { callerAgent, callerIp } from './request.js';

export type LifecycleControllerDeps = NdpaDeps & RecoveryDeps;

const SIGN_IN = 'Sign in to manage your account';

const closeInput = (req: Request, actor: Actor, body: z.output<typeof closeAccountBody>): CloseInput => ({
  userId: requireUserId(actor, SIGN_IN),
  sessionId: actor.principal?.sessionId,
  reasonCode: body.reason,
  password: body.password,
  stepUpToken: body.stepUpToken,
  ip: callerIp(req),
  userAgent: callerAgent(req),
});

/**
 * `GET /me`: who I am and the state of my account. The `account` block is the data behind screens
 * AS1/AS2 (suspension), CA1 (close) and the restricted banner.
 */
export async function getMe(deps: LifecycleControllerDeps, actor: Actor) {
  const userId = requireUserId(actor, SIGN_IN);
  const user = (
    await deps.db
      .select({
        id: users.id,
        publicId: users.publicId,
        username: users.username,
        verificationLevel: users.verificationLevel,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  return {
    ...user,
    contacts: await contactsOf(deps.db, userId),
    account: await getAccountNotice(deps.db, deps.ports ?? {}, userId),
  };
}

/**
 * "Proven first", spelled out because `DESC` alone would do the opposite.
 *
 * Postgres sorts `verified_at DESC` NULLS FIRST, so among rows with the same `is_primary` the
 * UNPROVEN row wins — which would badge a verified account "Not verified" the moment a channel
 * holds two rows. `verified_at IS NULL` ascending puts false (proven) first and never depends on a
 * null ordering default.
 */
const PROVEN_FIRST_EMAIL = sql`${userEmails.verifiedAt} IS NULL`;
const PROVEN_FIRST_PHONE = sql`${userPhones.verifiedAt} IS NULL`;

/**
 * Each channel's state for F-081's badges, masked.
 *
 * The proven row is what a screen means by "your email", but a phone-first account has no email at
 * all, and an account part-way through verification has one that is not proven — so "present" and
 * "verified" are two different questions and both are answered here.
 */
async function contactsOf(db: LifecycleControllerDeps['db'], userId: string) {
  const [email] = await db
    .select({ address: userEmails.email, verifiedAt: userEmails.verifiedAt })
    .from(userEmails)
    .where(eq(userEmails.userId, userId))
    .orderBy(PROVEN_FIRST_EMAIL, desc(userEmails.isPrimary), desc(userEmails.createdAt))
    .limit(1);
  const [phone] = await db
    .select({ address: userPhones.phoneE164, verifiedAt: userPhones.verifiedAt })
    .from(userPhones)
    .where(eq(userPhones.userId, userId))
    .orderBy(PROVEN_FIRST_PHONE, desc(userPhones.isPrimary), desc(userPhones.createdAt))
    .limit(1);

  return {
    email: email
      ? { present: true, masked: maskEmail(email.address), verified: email.verifiedAt !== null }
      : { present: false, masked: null, verified: false },
    phone: phone
      ? { present: true, masked: maskPhone(phone.address), verified: phone.verifiedAt !== null }
      : { present: false, masked: null, verified: false },
  };
}

export async function postClose(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof closeAccountBody>,
) {
  const closed = await closeOwnAccount(deps, closeInput(req, actor, body));
  return { status: 'CLOSED' as const, sessionsRevoked: closed.sessionsRevoked };
}

export function postDataExport(deps: LifecycleControllerDeps, req: Request, actor: Actor) {
  return requestDataExport(deps, {
    userId: requireUserId(actor, SIGN_IN),
    sessionId: actor.principal?.sessionId,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });
}

export async function postErasure(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof closeAccountBody>,
) {
  const receipt = await requestErasure(deps, closeInput(req, actor, body));
  return { status: 'CLOSED' as const, scheduledFor: receipt.scheduledFor };
}

export function postRecoveryRequest(
  deps: LifecycleControllerDeps,
  req: Request,
  body: z.output<typeof recoveryIntakeBody>,
) {
  return requestRecovery(deps, {
    identifier: body.identifier,
    method: body.method,
    ip: callerIp(req),
  });
}

export function getRecoveryQueue(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  query: z.output<typeof recoveryQuery>,
) {
  return listRecoveryRequests(deps.db, {
    actor: staffActor(actor, req),
    reason: requireReason(req, query.reason),
    status: query.status,
    page: query.page,
    limit: query.limit,
  });
}

export function postRecoveryDecision(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  requestId: string,
  body: z.output<typeof recoveryDecisionBody>,
) {
  return decideRecovery(deps, {
    actor: staffActor(actor, req),
    requestId,
    decision: body.decision,
    reason: requireReason(req, body.reason),
  });
}
