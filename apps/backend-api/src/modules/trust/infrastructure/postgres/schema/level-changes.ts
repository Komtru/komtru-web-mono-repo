// M6 §6.11, mirroring M1 §5.11: append-only. This is the record of why a user is allowed to
// transact, and a record that can be rewritten is not a record. The trigger and the narrowed
// komtru_app grant are in migration 0030 (helpers/appendOnly.ts).
import { bigserial, index, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { levelChangeActorType, levelChangeDirection } from './enums.js';
import { verificationRequests } from './requests.js';

export const verificationLevelChanges = trust.table(
  'verification_level_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').notNull(),
    fromLevel: smallint('from_level').notNull(),
    toLevel: smallint('to_level').notNull(),
    direction: levelChangeDirection('direction').notNull(),
    triggeringRequestId: uuid('triggering_request_id').references(() => verificationRequests.id),
    reason: text('reason').notNull(),
    actorType: levelChangeActorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
  },
  (table) => [
    // DESC NULLS FIRST, because `ORDER BY occurred_at DESC` is exactly that and an index built the
    // other way cannot serve it (the same note identity's audit table carries).
    index('verification_level_changes_user_idx').on(table.userId, table.occurredAt.desc().nullsFirst()),
  ],
);

export type VerificationLevelChange = typeof verificationLevelChanges.$inferSelect;
