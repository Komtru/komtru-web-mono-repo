'use client';

// `@komtru/api-client/react`: everything that needs React, TanStack Query or socket.io-client.
// Kept out of the package's main entry so a React Server Component can import the client itself.
export * from './account.js';
export * from './addresses.js';
export * from './client-context.js';
export * from './devices.js';
export * from './disputes.js';
export * from './evidence.js';
export * from './geo.js';
export * from './merchant.js';
export * from './payments.js';
export * from './payouts.js';
export * from './query.js';
export * from './realtime.js';
export * from './refunds.js';
export * from './tradeLive.js';
export * from './trades.js';
export type { RealtimeConnection, SocketLike } from '../realtime/connection.js';
export { attachRealtime } from '../realtime/connection.js';
