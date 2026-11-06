// T-042's `/me/addresses`, as HTTP. A thin layer: the rules, the lock, the events and the audit rows
// are in `address.service.ts`; this file resolves who is calling and where from.
//
// Nothing here logs a request body or an address field. The platform's request logging records the
// route and the status, and the fields of an address are PII (M1 §12).
import type { Request } from 'express';
import type { z } from 'zod';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import type { CursorKey } from '../../../../platform/http/paginate.js';
import {
  archiveAddress,
  createAddress,
  listAddresses,
  makeDefaultAddress,
  updateAddress,
  type AddressDeps,
  type AddressRequestContext,
} from '../../services/address.service.js';
import type { createAddressBodySchema, updateAddressBodySchema } from '../validations/address.validation.js';
import { callerAgent, callerIp } from './request.js';

export type AddressControllerDeps = AddressDeps;

const SIGN_IN = 'Sign in to manage your delivery addresses';

const requestContext = (req: Request, actor: Actor): AddressRequestContext => ({
  ip: callerIp(req),
  userAgent: callerAgent(req),
  sessionId: actor.principal?.sessionId ?? null,
});

export function getAddresses(
  deps: AddressControllerDeps,
  actor: Actor,
  query: { limit?: number | undefined },
  cursor: CursorKey | undefined,
) {
  return listAddresses(deps, { userId: requireUserId(actor, SIGN_IN), limit: query.limit ?? 20, cursor });
}

export function postAddress(
  deps: AddressControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof createAddressBodySchema>,
) {
  return createAddress(deps, {
    userId: requireUserId(actor, SIGN_IN),
    body,
    request: requestContext(req, actor),
  });
}

export function patchAddress(
  deps: AddressControllerDeps,
  req: Request,
  actor: Actor,
  params: { id: string },
  body: z.output<typeof updateAddressBodySchema>,
) {
  return updateAddress(deps, {
    userId: requireUserId(actor, SIGN_IN),
    addressId: params.id,
    body,
    request: requestContext(req, actor),
  });
}

export function postAddressArchive(
  deps: AddressControllerDeps,
  req: Request,
  actor: Actor,
  params: { id: string },
) {
  return archiveAddress(deps, {
    userId: requireUserId(actor, SIGN_IN),
    addressId: params.id,
    request: requestContext(req, actor),
  });
}

export function postAddressDefault(
  deps: AddressControllerDeps,
  req: Request,
  actor: Actor,
  params: { id: string },
) {
  return makeDefaultAddress(deps, {
    userId: requireUserId(actor, SIGN_IN),
    addressId: params.id,
    request: requestContext(req, actor),
  });
}
