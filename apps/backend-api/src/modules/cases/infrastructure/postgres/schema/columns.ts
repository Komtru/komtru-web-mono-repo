// The cases schema: the universal index of staff work (T-107, M15's "index, not copy"). Nothing the
// owning modules keep is copied here; a row points at it.
import { pgSchema } from 'drizzle-orm/pg-core';

export const cases = pgSchema('cases');
