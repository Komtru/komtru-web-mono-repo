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
import type { EventDefinition, NotificationChannel } from '@komtru/shared-types';
import type { z } from 'zod';
import { cityRequestDecided } from '../../geo/index.js';
import {
  identityDeviceSignedInEvent,
  identityOtpRequestedEvent,
  identityPasswordChangedEvent,
  otpPurposeLabel,
} from '../../identity/index.js';
import { identitySessionReuseDetectedEvent } from '@komtru/shared-types';
import { TRADE_NOTIFICATION_PLANS, resolveTradeAudience } from '../../trades/index.js';
import type { Tx } from '../../../platform/events/publish.js';

export interface NotificationRecipient {
  userId: string;
  /** Exactly the variables the bound template declares. A missing one fails the handler, loudly. */
  variables: Record<string, string>;
  /**
   * Restrict the fan-out to these channels. Absent means every channel the template declares.
   *
   * It exists because one template key can carry several channels — `identity.otp.requested` ships
   * an SMS body and an email body — while the EVENT knows which one the code was actually meant
   * for. Without it a phone registration code would also be emailed, to an address the account does
   * not have yet, dead-lettering a security-critical row on every single signup.
   */
  channels?: NotificationChannel[];
}

export interface NotificationBinding<S extends z.ZodType = z.ZodType> {
  /** The platform subscriber name: `notify.on-<event>`, e.g. `notify.on-otp-requested`. */
  subscriber: string;
  event: EventDefinition<S>;
  templateKey: string;
  /** Usually one recipient; a trade event tells both parties, so it is a list. */
  recipients: (payload: z.output<S>) => NotificationRecipient[];
  /**
   * For an event whose payload names a thing but not its people (a trade event carries a trade id, not
   * its buyer and seller). When present it is used INSTEAD of `recipients`, inside the subscriber's
   * transaction so the read agrees with the event. `recipients` is then unused and returns nobody.
   */
  audience?: (payload: z.output<S>, tx: Tx) => Promise<NotificationRecipient[]>;
}

export const defineBinding = <S extends z.ZodType>(binding: NotificationBinding<S>): NotificationBinding =>
  binding;

/**
 * Template keys whose whole job is to PROVE control of an address, so the address cannot already be
 * proven.
 *
 * `resolveDestination` otherwise treats an unverified contact as absent, and it is right to: sending
 * a password-reset link to an address nobody owns is how one reaches the wrong person. A
 * registration OTP is the exception that defines the rule — it is the thing that MAKES an address
 * verified, so demanding verification first is a cycle no user can break.
 *
 * It is a set here rather than a column on `notification_templates` because that table is data an
 * operator may edit at runtime (M11 D5), and "may this message go to an unproven address" is a
 * security decision that should need a deploy and a review, not an UPDATE.
 */
export const UNVERIFIED_DESTINATION_TEMPLATES: ReadonlySet<string> = new Set(['identity.otp.requested']);

export const allowsUnverifiedDestination = (templateKey: string): boolean =>
  UNVERIFIED_DESTINATION_TEMPLATES.has(templateKey);

/** Africa/Lagos, because that is where the person reading the message is (M1 locale defaults). */
const whenFor = (iso: string): string =>
  new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

/**
 * The sentence for each outcome of a city request. A rejection's reason is staff-written copy shown
 * to the requester as written, which is what the ticket asks for ("reject with reason").
 */
export function cityRequestOutcomeLine(input: {
  status: 'ADDED' | 'MERGED' | 'REJECTED';
  stateName: string;
  requestedName: string;
  cityName: string | null;
  reason: string | null;
}): string {
  switch (input.status) {
    case 'ADDED':
      return `Good news: ${input.cityName ?? input.requestedName} is now on Komtru. Pick it in ${input.stateName}.`;
    case 'MERGED':
      return `We already list this place as ${input.cityName ?? input.requestedName}. Pick that in ${input.stateName}.`;
    case 'REJECTED':
      return `We could not add it.${input.reason ? ` ${input.reason}` : ''}`;
  }
}

export const BINDINGS: NotificationBinding[] = [
  defineBinding({
    subscriber: 'notify.on-otp-requested',
    event: identityOtpRequestedEvent,
    templateKey: 'identity.otp.requested',
    recipients: (payload) =>
      // A challenge with no user is `/auth/password/forgot`'s decoy, written so a miss and a hit
      // leave the same trace. It is never delivered, so this is belt and braces — but a binding
      // that threw on a null user would turn that safety measure into a dead-lettered handler.
      payload.userId === null
        ? []
        : [
            {
              userId: payload.userId,
              channels: payload.channels,
              variables: {
                code: payload.code,
                purpose: otpPurposeLabel(payload.purpose),
                expiresInMinutes: String(payload.expiresInMinutes),
              },
            },
          ],
  }),

  defineBinding({
    subscriber: 'notify.on-device-signed-in',
    event: identityDeviceSignedInEvent,
    templateKey: 'identity.device.new_sign_in',
    recipients: (payload) => [
      {
        userId: payload.userId,
        variables: {
          deviceLabel: payload.deviceLabel,
          location: payload.location,
          signedInAt: whenFor(payload.signedInAt),
        },
      },
    ],
  }),

  defineBinding({
    subscriber: 'notify.on-password-changed',
    event: identityPasswordChangedEvent,
    templateKey: 'identity.password.changed',
    recipients: (payload) => [
      { userId: payload.userId, variables: { changedAt: whenFor(payload.changedAt) } },
    ],
  }),

  defineBinding({
    subscriber: 'notify.on-session-reuse-detected',
    event: identitySessionReuseDetectedEvent,
    templateKey: 'identity.session.reuse_detected',
    recipients: (payload) => [
      // The event carries no timestamp of its own: it is published the instant the replay is
      // detected, so the envelope's `occurredAt` and "now" differ by the relay's latency. Close
      // enough for copy that says "we signed you out at".
      { userId: payload.userId, variables: { detectedAt: whenFor(new Date().toISOString()) } },
    ],
  }),

  defineBinding({
    subscriber: 'notify.on-city-request-decided',
    event: cityRequestDecided,
    templateKey: 'geo.city_request.decided',
    recipients: (payload) => [
      {
        userId: payload.requesterUserId,
        variables: {
          requestedName: payload.requestedName,
          stateName: payload.stateName,
          outcomeLine: cityRequestOutcomeLine(payload),
        },
      },
    ],
  }),

  // T-068: every trade event the workspace surfaces. Who hears what is the trades module's plan.
  ...TRADE_NOTIFICATION_PLANS.map((plan) =>
    defineBinding({
      subscriber: plan.subscriber,
      event: plan.event,
      templateKey: plan.templateKey,
      recipients: () => [],
      audience: (payload, tx) => resolveTradeAudience(tx, plan, payload),
    }),
  ),
];
