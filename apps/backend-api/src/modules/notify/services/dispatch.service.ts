// Turning one domain event into notification rows (M11 §5).
//
// Runs INSIDE the subscriber's own transaction, which is what makes the whole module safe: the
// rows, the rate-limit charge and the IN_APP "sent" event are one atomic write with the
// processed_events marker, so a handler that throws leaves nothing behind and a redelivery redoes
// exactly the same work onto the same deterministic ids. Nothing external happens here. The only
// thing that leaves this function is a list of rows for the caller to enqueue after the commit.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { EventEnvelope, NotificationChannel } from '@komtru/shared-types';
import type { NotifyConfig } from '../../../config/env.js';
import type { Logger } from '../../../platform/logger.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { decideDelivery, rateLimitWindowStart, type DeliveryDecision } from '../domain/decide.js';
import { notificationDeadLettered, notificationSent } from '../domain/events.js';
import { notificationIdFor } from '../domain/identity.js';
import { renderTemplate, type NotificationTemplate } from '../domain/template.js';
import type { NotificationRecipient } from '../domain/binding.js';
import {
  notificationEventMappings,
  notificationPreferences,
  notificationRateLimits,
  notificationTemplates,
  notifications,
} from '../infrastructure/postgres/schema/index.js';
import { resolveDestination, resolveLocale, userExists } from './recipients.service.js';

export interface DispatchDeps {
  config: NotifyConfig;
  logger: Logger;
}

/** A row the caller must enqueue once its transaction has committed. */
export interface QueuedSend {
  notificationId: string;
  channel: NotificationChannel;
}

export interface DispatchInput {
  envelope: EventEnvelope<unknown>;
  templateKey: string;
  recipients: NotificationRecipient[];
}

const SUPPRESSION_REASON: Record<string, string> = {
  PREFERENCE_OPT_OUT: 'preference_opt_out',
  RATE_LIMITED: 'rate_limited',
  NO_DESTINATION: 'no_destination',
};

export async function dispatchForEvent(
  deps: DispatchDeps,
  tx: Tx,
  input: DispatchInput,
): Promise<QueuedSend[]> {
  const { envelope, templateKey, recipients } = input;

  // The data half of the mapping: present and enabled, or this event sends nothing. Checked once
  // per event rather than per recipient.
  const mapping = await tx
    .select({ id: notificationEventMappings.id })
    .from(notificationEventMappings)
    .where(
      and(
        eq(notificationEventMappings.eventName, envelope.eventType),
        eq(notificationEventMappings.templateKey, templateKey),
        eq(notificationEventMappings.enabled, true),
      ),
    )
    .limit(1);
  if (!mapping.length) {
    deps.logger.info({ event: envelope.eventType, templateKey }, 'notify: mapping absent or disabled');
    return [];
  }

  const queued: QueuedSend[] = [];
  for (const recipient of recipients) {
    queued.push(...(await dispatchToRecipient(deps, tx, envelope, templateKey, recipient)));
  }
  return queued;
}

async function dispatchToRecipient(
  deps: DispatchDeps,
  tx: Tx,
  envelope: EventEnvelope<unknown>,
  templateKey: string,
  recipient: NotificationRecipient,
): Promise<QueuedSend[]> {
  const { userId } = recipient;
  if (!(await userExists(tx, userId))) {
    // Deterministic: a user that is gone will still be gone on the retry, so this is not a failure.
    deps.logger.warn({ templateKey, userId }, 'notify: no such user, nothing to notify');
    return [];
  }

  const locale = await resolveLocale(tx, userId, deps.config.defaultLocale);
  const templates = await activeTemplates(tx, templateKey, locale, deps.config.defaultLocale);
  if (!templates.length) {
    // The boot check guarantees a default-locale template for every catalogue key, so reaching here
    // means the database and the catalogue disagree. Loud: the handler is retried and dead-letters.
    throw new Error(`notify: no active template for '${templateKey}' in '${locale}' or the default`);
  }

  const queued: QueuedSend[] = [];
  for (const template of templates) {
    const result = await dispatchOne(deps, tx, envelope, template, recipient);
    if (result) queued.push(result);
  }
  return queued;
}

async function dispatchOne(
  deps: DispatchDeps,
  tx: Tx,
  envelope: EventEnvelope<unknown>,
  template: NotificationTemplate,
  recipient: NotificationRecipient,
): Promise<QueuedSend | undefined> {
  const { userId } = recipient;
  const { channel, category, templateKey } = template;
  const destination = await resolveDestination(tx, userId, channel);
  const windowStart = rateLimitWindowStart(new Date(envelope.occurredAt), deps.config.rateLimitWindowMinutes);

  const decision = decideDelivery({
    securityCritical: template.isSecurityCritical,
    category,
    hasDestination: destination !== undefined,
    optedIn: await optedIn(tx, userId, category, channel),
    sendCountInWindow: await sendCount(tx, userId, channel, windowStart),
    maxPerWindow: deps.config.rateLimitMaxPerWindow,
  });

  const rendered = renderTemplate(template, recipient.variables);
  const id = notificationIdFor({ eventId: envelope.eventId, templateKey, channel, userId });
  const inApp = channel === 'IN_APP' && decision.kind === 'SEND';

  const inserted = await tx
    .insert(notifications)
    .values({
      id,
      userId,
      eventId: envelope.eventId,
      eventName: envelope.eventType,
      templateKey,
      templateVersion: template.version,
      channel,
      category,
      status: statusFor(decision, inApp),
      ...(rendered.subject === undefined ? {} : { renderedSubject: rendered.subject }),
      renderedBody: rendered.body,
      ...(destination ? { recipientMasked: destination.masked } : {}),
      ...(inApp ? { sentAt: new Date() } : {}),
      ...(failedReasonFor(decision) ? { failedReason: failedReasonFor(decision) } : {}),
      correlationId: envelope.eventId,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  // Already there: this event has been dispatched before. Charging the cap or re-publishing now
  // would double-count a send that already happened.
  if (!inserted.length) {
    deps.logger.debug({ notificationId: id, channel }, 'notify: already dispatched');
    return undefined;
  }

  if (decision.kind === 'UNDELIVERABLE') {
    await publish(tx, notificationDeadLettered, {
      payload: {
        notificationId: id,
        userId,
        channel,
        category,
        templateKey,
        reason: 'no_destination',
        attempts: 0,
      },
      aggregateType: 'notification',
      aggregateId: id,
      correlationId: envelope.correlationId ?? envelope.eventId,
      causationId: envelope.eventId,
    });
    return undefined;
  }

  if (decision.kind === 'SUPPRESS') return undefined;

  await chargeRateLimit(tx, userId, channel, windowStart);

  if (inApp) {
    // There is no provider and no job: the row IS the delivery. The event is what T-027's socket
    // gateway will subscribe to in order to push it to an open app.
    await publish(tx, notificationSent, {
      payload: { notificationId: id, userId, channel, category, templateKey },
      aggregateType: 'notification',
      aggregateId: id,
      correlationId: envelope.correlationId ?? envelope.eventId,
      causationId: envelope.eventId,
    });
    return undefined;
  }

  return { notificationId: id, channel };
}

const statusFor = (decision: DeliveryDecision, inApp: boolean) => {
  if (decision.kind === 'SUPPRESS') return 'SUPPRESSED' as const;
  if (decision.kind === 'UNDELIVERABLE') return 'DEAD_LETTERED' as const;
  return inApp ? ('SENT' as const) : ('QUEUED' as const);
};

const failedReasonFor = (decision: DeliveryDecision): string | undefined => {
  if (decision.kind === 'SUPPRESS') return SUPPRESSION_REASON[decision.reason];
  if (decision.kind === 'UNDELIVERABLE') return 'no_destination';
  return undefined;
};

/**
 * The highest active version for the user's locale, falling back to the default locale, one row per
 * channel the template declares (M11 D4: the channel list is static per template, and there is no
 * automatic cascade between channels).
 */
async function activeTemplates(
  tx: Tx,
  templateKey: string,
  locale: string,
  defaultLocale: string,
): Promise<NotificationTemplate[]> {
  const rows = await tx
    .select()
    .from(notificationTemplates)
    .where(and(eq(notificationTemplates.templateKey, templateKey), eq(notificationTemplates.active, true)))
    .orderBy(desc(notificationTemplates.version));

  const best = new Map<NotificationChannel, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.locale !== locale && row.locale !== defaultLocale) continue;
    const current = best.get(row.channel);
    // Ordered by version descending, so the first row for a channel wins — unless it is the
    // fallback locale and the user's own is still to come.
    if (!current || (current.locale !== locale && row.locale === locale)) best.set(row.channel, row);
  }

  return [...best.values()].map((row) => ({
    templateKey: row.templateKey,
    channel: row.channel,
    category: row.category,
    locale: row.locale,
    version: row.version,
    ...(row.subject === null ? {} : { subject: row.subject }),
    body: row.body,
    variables: row.variables,
    isSecurityCritical: row.isSecurityCritical,
  }));
}

async function optedIn(
  tx: Tx,
  userId: string,
  category: NotificationTemplate['category'],
  channel: NotificationChannel,
): Promise<boolean> {
  const rows = await tx
    .select({ optedIn: notificationPreferences.optedIn })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.category, category),
        eq(notificationPreferences.channel, channel),
      ),
    )
    .limit(1);
  // No row means opted in (M11 §4.4's default): a user who never touched their settings gets told.
  return rows[0]?.optedIn ?? true;
}

async function sendCount(
  tx: Tx,
  userId: string,
  channel: NotificationChannel,
  windowStart: Date,
): Promise<number> {
  const rows = await tx
    .select({ sendCount: notificationRateLimits.sendCount })
    .from(notificationRateLimits)
    .where(
      and(
        eq(notificationRateLimits.userId, userId),
        eq(notificationRateLimits.channel, channel),
        eq(notificationRateLimits.windowStartedAt, windowStart),
      ),
    )
    .limit(1);
  return rows[0]?.sendCount ?? 0;
}

/**
 * Charged only for a send that was actually admitted, and only when the notification row was newly
 * inserted, so a redelivery cannot spend a user's budget twice. Read-then-increment can over-admit
 * under concurrency; the subscriber queue runs one job at a time, so in practice it is serialised,
 * and a cap that occasionally admits one extra is a better failure than one that double-charges.
 */
async function chargeRateLimit(
  tx: Tx,
  userId: string,
  channel: NotificationChannel,
  windowStart: Date,
): Promise<void> {
  await tx
    .insert(notificationRateLimits)
    .values({ userId, channel, windowStartedAt: windowStart, sendCount: 1 })
    .onConflictDoUpdate({
      target: [
        notificationRateLimits.userId,
        notificationRateLimits.channel,
        notificationRateLimits.windowStartedAt,
      ],
      set: { sendCount: sql`${notificationRateLimits.sendCount} + 1` },
    });
}
