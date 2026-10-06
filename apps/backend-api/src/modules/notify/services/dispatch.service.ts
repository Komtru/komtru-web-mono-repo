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
import { TemplateRenderError, renderTemplate, type NotificationTemplate } from '../domain/template.js';
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

  // The data half of the mapping, checked once per event rather than per recipient. Disabled or
  // missing normally means "this event sends nothing" — that is M11 D5's point, turning a noisy
  // notification off without a deploy.
  //
  // It must NOT mean that for a security-critical template. An operator disabling the wrong row,
  // or a migration dropping it, would otherwise switch OTP delivery off platform-wide with no
  // notification row, no event and one info log to show for it — the exact silent suppression D2
  // forbids. So a security-critical template ignores the switch, loudly.
  const enabled = await mappingEnabled(tx, envelope.eventType, templateKey);
  if (!enabled) {
    if (!(await hasSecurityCriticalTemplate(tx, templateKey))) {
      deps.logger.info({ event: envelope.eventType, templateKey }, 'notify: mapping absent or disabled');
      return [];
    }
    deps.logger.error(
      { event: envelope.eventType, templateKey },
      'notify: mapping absent or disabled for a security-critical template; sending anyway (M11 D2)',
    );
  }

  const queued: QueuedSend[] = [];
  for (const recipient of recipients) {
    queued.push(...(await dispatchToRecipient(deps, tx, envelope, templateKey, recipient)));
  }
  return queued;
}

/** Whether an enabled mapping row exists for this (event, template) pair. */
async function mappingEnabled(tx: Tx, eventName: string, templateKey: string): Promise<boolean> {
  const rows = await tx
    .select({ id: notificationEventMappings.id })
    .from(notificationEventMappings)
    .where(
      and(
        eq(notificationEventMappings.eventName, eventName),
        eq(notificationEventMappings.templateKey, templateKey),
        eq(notificationEventMappings.enabled, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Whether any active template under this key is security-critical, in any channel or locale. */
async function hasSecurityCriticalTemplate(tx: Tx, templateKey: string): Promise<boolean> {
  const rows = await tx
    .select({ id: notificationTemplates.id })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.templateKey, templateKey),
        eq(notificationTemplates.active, true),
        eq(notificationTemplates.isSecurityCritical, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
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

  // A template that asks for a variable the binding does not supply is a content bug, and it is
  // one an operator can introduce at any time: D5 invites them to author new versions in the
  // database, where the boot check cannot reach. Letting it throw would roll the handler's whole
  // transaction back — including the SMS row for the SAME event, which would have rendered fine —
  // so a broken EMAIL copy would cost the user their OTP on every channel. It costs one channel.
  let rendered;
  try {
    rendered = renderTemplate(template, recipient.variables);
  } catch (error) {
    if (!(error instanceof TemplateRenderError)) throw error;
    return recordUnrenderable(deps, tx, envelope, template, userId, error);
  }
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
      // The EVENT id, not the envelope's correlationId: this column's job (M11 §4.3) is to tie one
      // event's multi-channel fan-out together, which is the join an operator needs. The envelope's
      // own correlation id travels on the events published below instead.
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

/**
 * Records the one channel whose copy is broken as DEAD_LETTERED, with the unrendered body so an
 * operator can see exactly what the template said, and escalates when it was security-critical.
 */
async function recordUnrenderable(
  deps: DispatchDeps,
  tx: Tx,
  envelope: EventEnvelope<unknown>,
  template: NotificationTemplate,
  userId: string,
  error: TemplateRenderError,
): Promise<undefined> {
  const { channel, category, templateKey } = template;
  const id = notificationIdFor({ eventId: envelope.eventId, templateKey, channel, userId });
  deps.logger.error(
    { notificationId: id, templateKey, channel, variable: error.variable },
    'notify: template could not be rendered',
  );

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
      status: 'DEAD_LETTERED',
      // Unrendered on purpose: it is never sent, and it is the evidence of what went wrong.
      renderedBody: template.body,
      failedReason: `template render failed: ${error.message}`,
      correlationId: envelope.eventId,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (inserted.length && template.isSecurityCritical) {
    await publish(tx, notificationDeadLettered, {
      payload: {
        notificationId: id,
        userId,
        channel,
        category,
        templateKey,
        reason: 'template_render_failed',
        attempts: 0,
      },
      aggregateType: 'notification',
      aggregateId: id,
      correlationId: envelope.correlationId ?? envelope.eventId,
      causationId: envelope.eventId,
    });
  }
  return undefined;
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
 * inserted, so a redelivery cannot spend a user's budget twice.
 *
 * Read-then-increment, which can over-admit: a subscriber's `concurrency: 1` is per worker PROCESS,
 * not fleet-wide, so N workers handling N events for the same user and channel can all read the
 * count before any of them charges, and the cap admits up to N extra. That direction is the safe
 * one — the alternative, charging first, would spend budget on sends that were then suppressed, and
 * on a security-critical send would consume a cap it is exempt from anyway. A cap that occasionally
 * lets one extra through beats one that silently eats a message.
 *
 * Security-critical sends are charged too, even though they bypass the check: the counter is meant
 * to say how many messages a user actually got on a channel, and an OTP is one of them.
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
