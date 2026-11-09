import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { CaseFacts } from '../../../domain/types.js';
import { cases } from './columns.js';
import { casePriority, caseState, caseType } from './enums.js';

/**
 * One row per piece of staff work, whatever module owns the record behind it. `subject_type` and
 * `subject_id` name that record (`dispute` / its id, `custody_parcel` / the parcel id): soft
 * references, because the owning schemas are not this module's to join. Registering the same subject
 * twice is the same case (the unique index), so an owning module may retry freely.
 */
export const caseIndex = cases.table(
  'cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The number staff say out loud (`C-002841`). Never reused, never reset. */
    caseNumber: bigint('case_number', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    type: caseType('type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    title: text('title').notNull(),
    state: caseState('state').notNull().default('OPEN'),
    priority: casePriority('priority').notNull().default('NORMAL'),
    /** Soft reference to identity.users(id). Null until someone takes the case. */
    ownerUserId: uuid('owner_user_id'),
    slaHours: integer('sla_hours').notNull(),
    slaStartedAt: timestamp('sla_started_at', { withTimezone: true }).notNull().defaultNow(),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),
    /** Small non-PII scalars the owning module keeps current; what the advisory reads. */
    facts: jsonb('facts').$type<CaseFacts>().notNull().default({}),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cases_case_number_unique').on(table.caseNumber),
    uniqueIndex('cases_subject_unique').on(table.type, table.subjectType, table.subjectId),
    check('cases_title_not_blank', sql`length(btrim(${table.title})) > 0`),
    check(
      'cases_subject_not_blank',
      sql`length(${table.subjectType}) > 0 AND length(${table.subjectId}) > 0`,
    ),
    check('cases_sla_positive', sql`${table.slaHours} > 0`),
    // A case in the "mine" queue and one in "unassigned" are told apart by the owner; a finished case
    // is in neither, so the partial indexes cover live work only.
    index('cases_queue_idx')
      .on(table.slaDueAt, table.id)
      .where(sql`${table.state} NOT IN ('DECIDED', 'CLOSED')`),
    index('cases_owner_idx')
      .on(table.ownerUserId, table.slaDueAt, table.id)
      .where(sql`${table.state} NOT IN ('DECIDED', 'CLOSED')`),
    index('cases_state_idx').on(table.state, table.type),
  ],
);
