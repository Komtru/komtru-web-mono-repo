// The IN_APP feed (M11 §7).
//
// IN_APP only: an email we sent is not something the app shows in a notification bell, and a feed
// that mixed the two would show the same event three times.
import { and, eq, isNull, lt, or, sql, desc } from 'drizzle-orm';
import type { NotificationCategory, Paginated } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { notifications } from '../infrastructure/postgres/schema/index.js';

export interface FeedItem {
  id: string;
  templateKey: string;
  category: NotificationCategory;
  subject: string | null;
  body: string;
  queuedAt: string;
  readAt: string | null;
}

export interface FeedQuery {
  limit: number;
  cursor?: CursorKey;
}

export async function listFeed(db: Db, userId: string, query: FeedQuery): Promise<Paginated<FeedItem>> {
  const { limit, cursor } = query;
  const before = typeof cursor?.queuedAt === 'string' ? new Date(cursor.queuedAt) : undefined;
  const beforeId = typeof cursor?.id === 'string' ? cursor.id : undefined;

  const rows = await db
    .select({
      id: notifications.id,
      templateKey: notifications.templateKey,
      category: notifications.category,
      subject: notifications.renderedSubject,
      body: notifications.renderedBody,
      queuedAt: notifications.queuedAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.channel, 'IN_APP'),
        // (queued_at, id) as one key, so two notifications in the same millisecond cannot hide
        // each other across a page boundary.
        before && beforeId
          ? or(
              lt(notifications.queuedAt, before),
              and(eq(notifications.queuedAt, before), lt(notifications.id, beforeId)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.queuedAt), desc(notifications.id))
    .limit(limit + 1);

  return cursorPage(
    rows.map((row) => ({
      id: row.id,
      templateKey: row.templateKey,
      category: row.category,
      subject: row.subject,
      body: row.body,
      queuedAt: row.queuedAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    })),
    limit,
    (row) => ({ queuedAt: row.queuedAt, id: row.id }),
  );
}

/**
 * False when the notification is not this user's (or does not exist). The route answers 404 either
 * way, so one user cannot learn another's notification ids by probing.
 */
export async function markRead(db: Db, userId: string, notificationId: string): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        eq(notifications.channel, 'IN_APP'),
        // Marking a read notification read again is a no-op, not a second write.
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  if (rows.length) return true;

  const existing = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        eq(notifications.channel, 'IN_APP'),
      ),
    );
  return existing.length > 0;
}
