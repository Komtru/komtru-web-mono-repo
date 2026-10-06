'use client';

// `@komtru/app-kit/react`: everything that needs React, TanStack Query or a socket. Kept out of the
// package's main entry so a React Server Component can import the config and session helpers alone.
export * from './providers.js';
