// The disputes schema (M3 §4): the financial case itself. A dispute references a trade, an order, a
// ticket and three users, and not one of those is a real foreign key — they live in other modules'
// schemas, and M3's whole boundary argument is that this module instructs them rather than reaching
// into them. Inside this schema the references are real, with an explicit onDelete.
import { pgSchema } from 'drizzle-orm/pg-core';

export const disputes = pgSchema('disputes');
