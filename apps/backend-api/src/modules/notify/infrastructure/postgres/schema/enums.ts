// M11 §4.1, built from the tuples in @komtru/shared-types so the database and the wire contract
// cannot drift: a channel the API can return is a channel a notification row can hold.
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from '@komtru/shared-types';
import { notify } from './columns.js';

export const notificationChannel = notify.enum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationStatus = notify.enum('notification_status', NOTIFICATION_STATUSES);
export const notificationCategory = notify.enum('notification_category', NOTIFICATION_CATEGORIES);
