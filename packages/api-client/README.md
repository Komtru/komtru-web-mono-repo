# `@komtru/api-client`

The one way the five Next.js apps talk to the platform. Typed endpoints built from the same zod
contracts the backend routes use, RFC 9457 problem details as typed errors, an in-memory access
token with a single-flight refresh, idempotency keys that survive a retry, and a durable replay
queue for a phone with no signal.

## Three entry points

| Import                       | Safe in a Server Component? | What is in it                                                          |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `@komtru/api-client`         | Yes                         | Contracts, transport, session, idempotency, retry policy, replay queue |
| `@komtru/api-client/browser` | No — IndexedDB              | `createIndexedDbQueueStore`, `isIndexedDbAvailable`                    |
| `@komtru/api-client/react`   | No — `"use client"`         | TanStack Query helpers, `RealtimeProvider` and its hooks               |

A test (`test/index.test.ts`) walks every module the main entry can reach and fails if any of them
mentions `react`, `@tanstack/react-query`, `socket.io-client`, `indexedDB` or `localStorage`.

## Endpoints

`defineEndpoint` mirrors the backend's `defineRoute` field for field — `method`, `path`, `scope`,
`retryable`, `paginated` and the zod schemas — so a module's route and its endpoint can be read side
by side. No endpoints ship here: each module ticket declares its own.

```ts
export const createTrade = defineEndpoint({
  method: 'post',
  path: '/trades',
  scope: 'CONSUMER',
  retryable: true, // exactly what the backend route declares
  schema: { body: createTradeBody, response: tradeSchema },
});

const trade = await api.call(createTrade, { body: { initiatorRole: 'BUYER' /* ... */ } });
```

## Shared dropdowns: `useStates()` and `useCities(stateId)`

The location catalog (T-046) is the one endpoint set every app reads, so its hooks live here. Mount
`ApiClientProvider` once beside your `QueryClientProvider`, then:

```tsx
const states = useStates(); // every state, all pages, flat
const cities = useCities(stateId); // idle until a state is chosen; keyed by state
```

Both ask the backend for its largest page (100) and follow `nextCursor`, so a dropdown holds the whole
list. Typeahead and "My city isn't listed" are endpoints (`searchCities`, `submitCityRequest`).

`retryable` is load-bearing: it is the only thing that makes this client send an `Idempotency-Key`,
and the only condition under which it will retry a mutation.

## The idempotency-key lifecycle

A key belongs to a **user action**, not to an HTTP attempt. One `call()` mints one UUID v7 before
its first attempt and sends it, with the same body, on every attempt that follows — the
refresh-and-retry after a 401, the backoff after a 429 or a 5xx, and the retry after the 409 that
means "a duplicate is still in flight". Pass `{ idempotencyKey }` to continue an action across
calls: a "try again" button (`beginUserAction()`) or a replay from the durable queue, which stores
the key it was given at enqueue and never mints a new one. A 422 `IDEMPOTENCY_KEY_REUSED` is never
retried — it means a different body went out under a key that was already used, which is a bug in
the caller, not a transient failure.

## The single-flight refresh

The access token lives in memory; the refresh token is an httpOnly cookie only the app's own
`/api/auth/refresh` route handler can read. Every token read carries a **generation**. On a 401 a
request calls `refreshOnce(seen)`: if the store's generation has already moved past `seen`, someone
else refreshed while this request was in flight and it simply retries with the new token; otherwise
it joins or starts the single in-flight refresh. Twenty requests that all 401 together therefore
produce one refresh, and each gets exactly one retry. A refresh that resolves `null` ends the
session once and the original 401 surfaces.

## The durable retry queue

Replay is strictly FIFO and one at a time. A failure a repeat can fix **blocks the head** — "parcel
released" must never reach the server before "parcel received". A failure a repeat cannot fix, or
one attempt too many, drops the entry and emits `dropped` so the UI can say what did not go through.
`park-agent-app` pairs it with `createIndexedDbQueueStore()` so a queued release survives a reload.

**What a dropped entry means for the app that consumes this.** Dropping the head and carrying on is
the lesser of two evils, but it does break the ordering invariant for the entries behind it: if
"parcel received" is dropped with a 403, "parcel released" will still be sent. Nothing here marks
those followers as suspect — the ticket that owns the queued UI (T-16x) has to decide what an agent
sees, which is why `dropped` carries the whole entry and the error. `queueRetryDelayMs(entry, error)`
says how long to wait before the next `flush()`.

Note the nesting: the client retries up to `maxAttempts` (3) inside each queue attempt, and the
queue allows up to `maxAttempts` (10) of its own, so one entry can cost up to 30 requests before it
is dropped. Lower either for a chattier endpoint.

## Seams left for other tickets

- **T-017** owns the `/api/auth/*` route handlers; this package supplies `authRoutePaths()`,
  `createRouteHandlerRefresh()` and `backendLoginPath(scope)`.
- **T-027** owns the socket gateway. `RealtimeProvider` takes an injectable `connect`, and the
  5-minute socket token is minted by the app's Server Component layout (socket guide §6). The
  provider re-keys its effect on `token` and connects with `forceNew: true`, because socket.io caches
  one Manager per URL and honours `auth` only when the socket is first created — without it a
  reminted token would reconnect carrying the expired one.
- **T-031/T-034** own login and refresh; `authSessionSchema` is `{ accessToken, scope, expiresAt? }`.
- Wiring `flush()` to `online` or `visibilitychange` belongs to the app that owns the queued UI.
