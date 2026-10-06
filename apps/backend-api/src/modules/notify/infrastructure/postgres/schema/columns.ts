// The notify schema. Every table M11 §4 declares lives here; nothing notify owns lives in public
// (design §4.2).
import { pgSchema } from 'drizzle-orm/pg-core';

export const notify = pgSchema('notify');
