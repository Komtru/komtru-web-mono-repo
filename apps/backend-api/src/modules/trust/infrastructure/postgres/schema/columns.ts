// The trust schema. Every table M6 §6 declares lives here; nothing trust owns lives in public
// (design §4.2).
import { pgSchema } from 'drizzle-orm/pg-core';

export const trust = pgSchema('trust');
