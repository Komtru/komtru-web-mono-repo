// The signed-in buyer's saved delivery addresses (T-042). Mirrors the backend's `/me/addresses` routes
// field for field. An address is archived, never deleted, so there is no delete endpoint.
//
// The list is the live addresses, default first. An account holds at most `MAX_ADDRESSES_PER_USER`, so
// `fetchAllAddresses` walks the cursor to the end in one request in practice.
import {
  MAX_ADDRESSES_PER_USER,
  addressSchema,
  createAddressBodySchema,
  cursorPageRequestSchema,
  paginatedSchema,
  updateAddressBodySchema,
} from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';
import type { ApiClient } from './client.js';
import { collectCursorPages } from './pagination.js';

export { MAX_ADDRESSES_PER_USER };

const addressParams = z.object({ id: z.uuid() });

export const listAddresses = defineEndpoint({
  method: 'get',
  path: '/me/addresses',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: { query: cursorPageRequestSchema, response: paginatedSchema(addressSchema) },
});

/** Retryable: a second POST would be a second address, so the client sends an idempotency key. */
export const createAddress = defineEndpoint({
  method: 'post',
  path: '/me/addresses',
  scope: 'CONSUMER',
  retryable: true,
  schema: { body: createAddressBodySchema, response: addressSchema },
});

export const updateAddress = defineEndpoint({
  method: 'patch',
  path: '/me/addresses/:id',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: addressParams, body: updateAddressBodySchema, response: addressSchema },
});

export const archiveAddress = defineEndpoint({
  method: 'post',
  path: '/me/addresses/:id/archive',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: addressParams, response: addressSchema },
});

export const makeDefaultAddress = defineEndpoint({
  method: 'post',
  path: '/me/addresses/:id/default',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: addressParams, response: addressSchema },
});

/** Every live address, all pages. */
export const fetchAllAddresses = (client: ApiClient, signal?: AbortSignal) =>
  collectCursorPages((cursor) =>
    client.call(
      listAddresses,
      { query: { limit: MAX_ADDRESSES_PER_USER, ...(cursor ? { cursor } : {}) } },
      signal ? { signal } : {},
    ),
  );
