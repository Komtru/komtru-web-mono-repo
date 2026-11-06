// The config schema. Every table M17 section 3 declares lives here (design 4.2).
import { pgSchema } from 'drizzle-orm/pg-core';

export const config = pgSchema('config');
