// A compile-time test: `tsc` checking this file is the assertion, and each `@ts-expect-error` fails
// the typecheck if the mistake it describes stops being a mistake. Not a vitest file on purpose.
import { z } from 'zod';
import { createApiClient } from '../src/client.js';
import { defineEndpoint } from '../src/contracts.js';

const createTrade = defineEndpoint({
  method: 'post',
  path: '/trades',
  scope: 'CONSUMER',
  retryable: true,
  schema: { body: z.object({ amount: z.string() }), response: z.object({ id: z.string() }) },
});

const getTrade = defineEndpoint({
  method: 'get',
  path: '/trades/:id',
  scope: 'CONSUMER',
  schema: { params: z.object({ id: z.string() }), response: z.object({ id: z.string() }) },
});

const api = createApiClient({ baseUrl: 'http://localhost' });

// @ts-expect-error this endpoint declares no params schema
void api.call(createTrade, { params: { id: 'x' }, body: { amount: '1' } });
// @ts-expect-error the body this endpoint declares is required
void api.call(createTrade, {});
// @ts-expect-error the params this endpoint declares are required
void api.call(getTrade, {});

void api.call(createTrade, { body: { amount: '1' } }).then((trade) => trade.id);
void api.call(getTrade, { params: { id: 't1' } }).then((trade) => trade.id);
