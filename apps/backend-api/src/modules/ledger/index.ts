// The ledger module's public surface (design §4.2): other modules reach the chart of accounts, the
// posting function and the balance queries through here, and the komtru/module-boundaries rule
// makes this the only way in. The ledger never transitions a trade and never computes a fee — fee
// amounts arrive already computed from the trade's snapshot (design §6.5).
export * from './domain/accounts.js';
export * from './domain/journal.js';
export * from './domain/events.js';
export * from './infrastructure/postgres/schema/index.js';
