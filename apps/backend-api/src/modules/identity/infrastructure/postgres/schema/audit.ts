// M1 §5.11. Every auth-sensitive action, append-only (migration 0012). No foreign keys at all: an
// audit row must outlive the account it describes, and a cascade would erase the evidence an
// investigation needs.
import { bigserial, index, inet, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { identity } from './columns.js';

export const identityAuditLog = identity.table(
  'identity_audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL for system or anonymous actors. */
    actorUserId: uuid('actor_user_id'),
    /** USER | STAFF | SYSTEM | ANONYMOUS. */
    actorType: text('actor_type').notNull(),
    subjectUserId: uuid('subject_user_id'),
    /** PASSWORD_CHANGED, ROLE_GRANTED, … */
    action: text('action').notNull(),
    /** SUCCESS | FAILURE | DENIED. */
    outcome: text('outcome').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    deviceId: uuid('device_id'),
    sessionId: uuid('session_id'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    metadata: jsonb('metadata'),
    correlationId: uuid('correlation_id'),
  },
  (table) => [
    index('identity_audit_subject_idx').on(table.subjectUserId, table.occurredAt.desc()),
    index('identity_audit_actor_idx').on(table.actorUserId, table.occurredAt.desc()),
    index('identity_audit_action_idx').on(table.action, table.occurredAt.desc()),
  ],
);
