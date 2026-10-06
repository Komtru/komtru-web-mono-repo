// Trust & Verification (M6) — the ONLY public surface of this module.
//
// What other modules get is the schema they read and the registry entry. What they deliberately do
// NOT get, and must not:
//
//  - **anything that takes a raw NIN or BVN.** There is exactly one way a number enters this
//    program, `POST /verification/{nin,bvn}`, and it is sealed before it leaves the request handler.
//    A second entry point is the one that forgets to seal it.
//  - **the provider adapters.** `infrastructure/providers/*.client.ts` is reachable from `jobs/` and
//    nowhere else, so no request handler can ever call a provider on the request path.
//  - **a way to set `users.verification_level` directly.** Levels move through the append-only
//    change log or not at all.
export * from './infrastructure/postgres/schema/index.js';

export { createTrustModule, EXPIRE_STALE_CRON, type TrustModuleOptions } from './module.js';
export * from './domain/events.js';
export { TRUST_QUEUES, TRUST_SCHEDULES, VERIFICATION_SOCKET_EVENT } from './domain/queues.js';
