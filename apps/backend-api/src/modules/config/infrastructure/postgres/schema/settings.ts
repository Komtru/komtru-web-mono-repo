// M17 sections 3.1 to 3.3.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { config } from './columns.js';

export const CHANGE_TARGETS = ['SETTING', 'FLAG'] as const;

export const platformSettings = config.table(
  'platform_settings',
  {
    namespace: text('namespace').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    valueType: text('value_type').notNull(),
    description: text('description').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft reference to identity.users(id): cross-schema references are plain uuid (design 4.2). */
    updatedByAdminId: uuid('updated_by_admin_id'),
  },
  (table) => [
    primaryKey({ columns: [table.namespace, table.key] }),
    check(
      'platform_settings_value_type',
      sql`${table.valueType} IN ('INTEGER', 'BOOLEAN', 'STRING', 'DECIMAL')`,
    ),
  ],
);

export const featureFlags = config.table('feature_flags', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  rolloutNote: text('rollout_note'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedByAdminId: uuid('updated_by_admin_id'),
});

/** Append-only (migration 0033): the history of every consequential constant the platform has had. */
export const configChangeLog = config.table(
  'config_change_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    changeTarget: text('change_target').notNull(),
    namespaceOrFlagCode: text('namespace_or_flag_code').notNull(),
    /** Null for a flag change. */
    key: text('key'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value').notNull(),
    changedByAdminId: uuid('changed_by_admin_id').notNull(),
    /** Not in M17 section 3.3: the ticket requires a reason on every change, and it belongs with the row. */
    reason: text('reason').notNull(),
  },
  (table) => [
    check('config_change_log_target', sql`${table.changeTarget} IN ('SETTING', 'FLAG')`),
    index('config_change_log_target_idx').on(table.namespaceOrFlagCode, sql`${table.occurredAt} DESC`),
  ],
);
