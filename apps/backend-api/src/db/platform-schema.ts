// Schema for cross-module database plumbing (e.g. the append-only trigger function). No tables.
import { pgSchema } from 'drizzle-orm/pg-core';

export const platform = pgSchema('platform');
