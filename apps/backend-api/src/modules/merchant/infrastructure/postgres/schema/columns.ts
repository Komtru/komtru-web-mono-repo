// The merchant schema (T-055): applications, their documents and decision log, the certified profile and
// its badge. Soft references everywhere across a module boundary (users, files, geo, payout accounts, cases).
import { pgSchema } from 'drizzle-orm/pg-core';

export const merchant = pgSchema('merchant');
