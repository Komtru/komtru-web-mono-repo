// Enums shared by the backend and every app. Defined once here, never redeclared in an app.
import { z } from 'zod';

/** One user, three ways to sign in (design §7.3); Park Agents use LOGISTICS. */
export const SESSION_SCOPES = ['CONSUMER', 'STAFF', 'LOGISTICS'] as const;
export const sessionScopeSchema = z.enum(SESSION_SCOPES);
export type SessionScope = z.infer<typeof sessionScopeSchema>;

export const CURRENCIES = ['NGN'] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

/** M11 §4.1. One channel per notification row; a template declares the channels it fans out to. */
export const NOTIFICATION_CHANNELS = ['PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'VOICE', 'IN_APP'] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** `SUPPRESSED` is a decision, not a failure: the row records why the user was not told. */
export const NOTIFICATION_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'DEAD_LETTERED',
  'SUPPRESSED',
] as const;
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** What a user may opt out of, per channel — except `SECURITY`, which M11 D2 makes non-optional. */
export const NOTIFICATION_CATEGORIES = [
  'SECURITY',
  'TRADE',
  'PAYMENT',
  'DISPUTE',
  'TICKET',
  'MARKETING',
  'ACCOUNT',
] as const;
export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
