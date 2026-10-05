// What ties a domain event to a template (M11 §3).
//
// Two halves, deliberately: the BINDING is code, because pulling "who should be told" and "with
// what values" out of a payload is code; the `notification_event_mappings` ROW is data, because
// turning a noisy notification off at 3am must not need a deploy. Both are checked at boot, and a
// mapping row that is missing or disabled stops the send even though the binding is registered.
//
// Bindings live here rather than in the publishing module so there is one file that answers "which
// event sends what". Every later module ticket adds its own entries to BINDINGS, importing its
// event definition through that module's index.ts barrel.
import type { EventDefinition } from '@komtru/shared-types';
import type { z } from 'zod';

export interface NotificationRecipient {
  userId: string;
  /** Exactly the variables the bound template declares. A missing one fails the handler, loudly. */
  variables: Record<string, string>;
}

export interface NotificationBinding<S extends z.ZodType = z.ZodType> {
  /** The platform subscriber name: `notify.on-<event>`, e.g. `notify.on-otp-requested`. */
  subscriber: string;
  event: EventDefinition<S>;
  templateKey: string;
  /** Usually one recipient; a trade event tells both parties, so it is a list. */
  recipients: (payload: z.output<S>) => NotificationRecipient[];
}

export const defineBinding = <S extends z.ZodType>(binding: NotificationBinding<S>): NotificationBinding =>
  binding as unknown as NotificationBinding;

/**
 * Empty at T-045: no module publishes a user-facing event yet. T-031 and T-034 add the identity
 * bindings for the templates already seeded in catalogue.ts; T-068 adds the trade ones.
 */
export const BINDINGS: NotificationBinding[] = [];
