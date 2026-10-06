// The consumer-facing half of M11 §7: the in-app feed and the preference switches.
//
// Every route here resolves the caller from `ctx.actor` and refuses an anonymous one. Sessions
// arrive in T-031, so until then `resolveActor` is not supplied and every caller IS anonymous and
// every one of these answers 401. That is the point: a route that returns another person's
// messages must fail closed while the authentication it depends on does not exist, rather than
// quietly serving whatever the client asks for.
import { notificationCategorySchema, notificationChannelSchema, paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { requireUserId } from '../../../platform/http/principal.js';
import { cursorPage } from '../../../platform/http/paginate.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { listFeed, markRead } from '../services/feed.service.js';
import {
  SecurityPreferenceError,
  getPreferences,
  setPreferences,
  type PreferenceRow,
} from '../services/preferences.service.js';

/** The preference matrix is a fixed list, so its cursor is simply the last pair returned. */
const preferenceKey = (row: PreferenceRow) => `${row.category}|${row.channel}`;

// Case-insensitive: whichever shape T-031 formats an actor in, an upper-case uuid must not
// come back as an opaque 401.
const SEE_NOTIFICATIONS = 'Sign in to see your notifications';

const feedItemSchema = z.object({
  id: z.uuid(),
  templateKey: z.string(),
  category: notificationCategorySchema,
  subject: z.string().nullable(),
  body: z.string(),
  queuedAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});

const preferenceSchema = z.object({
  category: notificationCategorySchema,
  channel: notificationChannelSchema,
  optedIn: z.boolean(),
});

export function notifyRoutes(db: () => Db): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/notifications',
      scope: 'CONSUMER',
      summary: "The caller's in-app notification feed, newest first",
      paginated: 'cursor',
      schema: { response: paginatedSchema(feedItemSchema) },
      handler: ({ actor, query, cursor }) =>
        listFeed(db(), requireUserId(actor, SEE_NOTIFICATIONS), {
          limit: query.limit ?? 20,
          ...(cursor ? { cursor } : {}),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/notifications/:id/mark-read',
      scope: 'CONSUMER',
      summary: 'Mark one in-app notification read',
      // Marking a read notification read again is harmless, so no idempotency key is needed.
      retryable: false,
      schema: {
        params: z.object({ id: z.uuid() }),
        response: z.object({ read: z.literal(true) }),
      },
      handler: async ({ actor, params }) => {
        const found = await markRead(db(), requireUserId(actor, SEE_NOTIFICATIONS), params.id);
        // 404 whether the row belongs to somebody else or does not exist: the two must not be
        // distinguishable, or the endpoint becomes an id oracle.
        if (!found) throw new ApiError(404, 'NOT_FOUND', 'No such notification');
        return { read: true as const };
      },
    }),

    defineRoute({
      method: 'get',
      path: '/notification-preferences',
      scope: 'CONSUMER',
      summary: 'Every notification category and channel the caller may turn off',
      paginated: 'cursor',
      schema: { response: paginatedSchema(preferenceSchema) },
      handler: async ({ actor, query, cursor }) => {
        const all = await getPreferences(db(), requireUserId(actor, SEE_NOTIFICATIONS));
        const after = typeof cursor?.key === 'string' ? cursor.key : undefined;
        const start = after ? all.findIndex((row) => preferenceKey(row) === after) + 1 : 0;
        const limit = query.limit ?? 20;
        return cursorPage(all.slice(start, start + limit + 1), limit, (row) => ({
          key: preferenceKey(row),
        }));
      },
    }),

    defineRoute({
      method: 'put',
      path: '/notification-preferences',
      scope: 'CONSUMER',
      summary: 'Turn notification categories on or off per channel',
      retryable: false,
      schema: {
        body: z.object({ preferences: z.array(preferenceSchema).min(1).max(64) }),
        // Not the new matrix: a collection response would have to be paginated, and a paginated PUT
        // is a contract nobody wants. The client re-reads GET if it needs the whole picture.
        response: z.object({ updated: z.number().int().min(0) }),
      },
      handler: async ({ actor, body }) => {
        const userId = requireUserId(actor, SEE_NOTIFICATIONS);
        try {
          await setPreferences(db(), userId, body.preferences);
        } catch (error) {
          if (error instanceof SecurityPreferenceError) {
            throw new ApiError(
              422,
              'VALIDATION_FAILED',
              'Security notifications cannot be turned off',
              'OTPs and account-security alerts are always delivered (M11 D2). Storing this would be a setting we ignore.',
            );
          }
          throw error;
        }
        return { updated: body.preferences.length };
      },
    }),
  ];
}
