'use client';

// `@komtru/api-client/react`: everything that needs React, TanStack Query or socket.io-client.
// Kept out of the package's main entry so a React Server Component can import the client itself.
export * from './addresses.js';
export * from './client-context.js';
export * from './geo.js';
export * from './payments.js';
export * from './payouts.js';
export * from './query.js';
export * from './realtime.js';
export * from './tradeLive.js';
export * from './trades.js';
export type { RealtimeConnection, SocketLike } from '../realtime/connection.js';
export { attachRealtime } from '../realtime/connection.js';
