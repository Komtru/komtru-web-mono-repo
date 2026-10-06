// M6 §6.10. Written on every provider call, successful or not — this is the only record that money
// was spent, and the input to §9's `verification.provider_degraded`.
import { bigserial, boolean, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { kycProvider, verificationType } from './enums.js';
import { verificationRequests } from './requests.js';

export const kycProviderCalls = trust.table(
  'kyc_provider_calls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** SET NULL rather than CASCADE: the cost record outlives the request it was spent on. */
    requestId: uuid('request_id').references(() => verificationRequests.id, { onDelete: 'set null' }),
    provider: kycProvider('provider').notNull(),
    callType: verificationType('call_type').notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    /** For reconciliation against opaque vendor pricing (§8). Null when the call cost nothing. */
    costEstimateKobo: integer('cost_estimate_kobo'),
    succeeded: boolean('succeeded').notNull(),
    /**
     * This build's addition to §6.10. "Failed" with no shape is not an error rate: a 402 from an
     * exhausted prepaid balance and a connection timeout need different humans, and
     * `verification.provider_degraded` cannot distinguish them from a boolean.
     */
    errorKind: text('error_kind'),
    calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('kyc_provider_calls_provider_idx').on(table.provider, table.calledAt.desc().nullsFirst()),
  ],
);

export type KycProviderCall = typeof kycProviderCalls.$inferSelect;
