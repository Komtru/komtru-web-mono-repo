// The files schema. Every table M20 §3 declares lives here; nothing files owns lives in public
// (design §4.2).
import { pgSchema } from 'drizzle-orm/pg-core';

export const files = pgSchema('files');
