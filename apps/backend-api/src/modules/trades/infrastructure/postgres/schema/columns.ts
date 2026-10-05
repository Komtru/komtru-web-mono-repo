// The trade schema. Every trades table is declared on `trade`; nothing this module owns lives in
// public (design §4.2). The module is called `trades`, the Postgres schema `trade`, as the design's
// module table prescribes.
import { pgSchema } from 'drizzle-orm/pg-core';

export const trade = pgSchema('trade');
