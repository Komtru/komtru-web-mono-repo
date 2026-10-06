// What notify publishes (M11 §6). The direction is inverted from every other module: notify mostly
// consumes other modules' events, and these three exist for observability and for the one piece of
// business logic downstream — T-100 opens a support ticket when a SECURITY notification dies.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';
import { notificationCategorySchema, notificationChannelSchema } from '@komtru/shared-types';

const base = {
  notificationId: z.uuid(),
  userId: z.uuid(),
  channel: notificationChannelSchema,
  category: notificationCategorySchema,
  templateKey: z.string().min(1),
};

export const notificationSent = defineEvent('notify.notification.sent', 1, z.object(base));

export const notificationFailed = defineEvent(
  'notify.notification.failed',
  1,
  z.object({ ...base, reason: z.string().min(1), attempt: z.number().int().min(1) }),
);

/**
 * The job gave up, or there was nowhere to send a security-critical message. Ops alerting consumes
 * every one of these; T-100 opens a ticket for the SECURITY ones.
 */
export const notificationDeadLettered = defineEvent(
  'notify.notification.dead_lettered',
  1,
  z.object({ ...base, reason: z.string().min(1), attempts: z.number().int().min(0) }),
);
