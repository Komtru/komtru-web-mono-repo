// M11 §4.2. Templates are data, not code (D5): a copy change is a new row, not a deploy. The
// catalogue shipped in domain/catalogue.ts is only the default content; the database is what a send
// actually renders from.
import { sql } from 'drizzle-orm';
import { boolean, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { notify } from './columns.js';
import { notificationCategory, notificationChannel } from './enums.js';

export const notificationTemplates = notify.table(
  'notification_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `identity.otp.requested`: the module that owns the event, then what happened. */
    templateKey: text('template_key').notNull(),
    channel: notificationChannel('channel').notNull(),
    category: notificationCategory('category').notNull(),
    locale: text('locale').notNull().default('en-NG'),
    version: integer('version').notNull().default(1),
    /** Null for every channel but EMAIL; the schema in domain/template.ts is what enforces that. */
    subject: text('subject'),
    body: text('body').notNull(),
    /**
     * The `{{placeholders}}` the body and subject use. Checked against the body at boot, so a
     * template that asks for a variable no binding supplies fails there rather than at 2am.
     */
    variables: text('variables')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** M11 D2: bypasses preferences and per-user caps. Never set on anything but a security message. */
    isSecurityCritical: boolean('is_security_critical').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_templates_key_channel_locale').on(
      table.templateKey,
      table.channel,
      table.locale,
      table.version,
    ),
    index('notification_templates_active_idx')
      .on(table.templateKey)
      .where(sql`${table.active}`),
  ],
);

/**
 * Which event fires which template. The binding in domain/binding.ts carries the code (how to pull
 * recipients and variables out of a payload); this row is the runtime switch, so a noisy
 * notification can be turned off without a deploy.
 */
export const notificationEventMappings = notify.table(
  'notification_event_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventName: text('event_name').notNull(),
    templateKey: text('template_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_event_mappings_pair').on(table.eventName, table.templateKey),
    index('notification_event_mappings_event_idx')
      .on(table.eventName)
      .where(sql`${table.enabled}`),
  ],
);
