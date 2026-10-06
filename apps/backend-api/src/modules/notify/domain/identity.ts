// The identity of a notification: a uuid v5 over the event, the template, the channel and the user.
//
// THIS IS THE IDEMPOTENCY BOUNDARY of the whole module. The outbox gives at-least-once delivery of
// the EVENT, so the subscriber's handler can run more than once — on a redelivery, on a retry after
// it threw, or because an operator replayed something. Every one of those runs computes the same id
// and collides with the primary key, so the fan-out is written once. What stops the SECOND SMS,
// though, is not this: it is the claim in services/delivery.service.ts, which moves the row out of
// QUEUED before any provider is touched. This id is what makes that claim possible, by guaranteeing
// there is exactly one row to claim.
import { v5 as uuidv5 } from 'uuid';
import type { NotificationChannel } from '@komtru/shared-types';

/** A fixed namespace for notify. Never changed: changing it re-sends the backlog. */
export const NOTIFY_ID_NAMESPACE = '6f1c9b6e-3f6a-5a9e-9d3c-4a7f2b8e5c10';

export interface NotificationIdentity {
  eventId: string;
  templateKey: string;
  channel: NotificationChannel;
  userId: string;
}

export const notificationIdFor = ({ eventId, templateKey, channel, userId }: NotificationIdentity): string =>
  uuidv5(`${eventId}:${templateKey}:${channel}:${userId}`, NOTIFY_ID_NAMESPACE);
