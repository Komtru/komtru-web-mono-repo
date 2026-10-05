// The ledger schema (design §4.2). Every table this module owns is declared on it; nothing the
// ledger owns lives in public.
import { pgSchema } from 'drizzle-orm/pg-core';

export const ledger = pgSchema('ledger');
