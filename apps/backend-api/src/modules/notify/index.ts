// The notify module's public surface (M11).
//
// Other modules read these tables, publish events that notify's bindings catch, and subscribe to
// what notify emits — `notify.notification.dead_lettered` is the one T-100 opens a support ticket
// from. The komtru/module-boundaries rule makes this the only way in.
export * from './infrastructure/postgres/schema/index.js';
export { notificationSent, notificationFailed, notificationDeadLettered } from './domain/events.js';
export { defineBinding, type NotificationBinding, type NotificationRecipient } from './domain/binding.js';
export { createNotifyModule, notifyModule } from './module.js';
