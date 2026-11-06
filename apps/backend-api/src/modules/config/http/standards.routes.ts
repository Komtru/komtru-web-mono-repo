// T-049 routes. The reads are public, like the fee schedule: CTS1 shows a standard before a buyer has a
// session, and trade creation reads the same body. The writes are STAFF with `config.manage`, a reason on
// every change, and a strict body so no fee member can ride along.
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { checkStandardRules, itemSpecFieldSchema, standardObject } from '../domain/standards.js';
import {
  publishStandard,
  getCurrentStandard,
  getStandardVersion,
  listCurrentStandards,
  toPublicView,
} from '../services/standards.service.js';
import { configActor, requireReason, type ConfigHttpDeps } from './controllers.js';
import { listQuery } from './validations.js';
import { pagedSchema } from '@komtru/shared-types';

const READ_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const PUBLIC_BUDGET = { points: 120, durationSeconds: 60, by: ['ip' as const] };
const WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

const categoryParams = z.object({ categoryCode: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/) });
const versionParams = z.object({ id: z.uuid() });

const publicView = z.object({
  versionId: z.uuid(),
  categoryCode: z.string(),
  categoryName: z.string(),
  versionNumber: z.int(),
  createdAt: z.date(),
  inspectionWindowHours: z.int(),
  itemSpecFields: z.array(itemSpecFieldSchema),
  proofMedia: z.object({ minPhotos: z.int(), requireVideo: z.boolean() }),
  imeiVerification: z.boolean(),
  deliveryDeadlineDays: z.int(),
});
const adminView = publicView.extend({ reason: z.string(), changedByAdminId: z.uuid().nullable() });

const putBodySchema = standardObject
  .extend({ reason: z.string().max(1000).optional() })
  .superRefine(checkStandardRules);

/**
 * Cache-Control is set only after the lookup succeeds; an error is never cacheable. The "current" reads
 * are `no-cache` (always revalidate) with an ETag on the version id(s), which Express turns into a 304
 * for a matching If-None-Match: a new version is visible at once, an unchanged one costs no body.
 */
async function cached<T>(res: Response, control: string, lookup: () => Promise<T>): Promise<T> {
  try {
    const value = await lookup();
    res.setHeader('Cache-Control', control);
    return value;
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    throw error;
  }
}

const etagOf = (versionIds: string[]) => `"${createHash('sha1').update(versionIds.join(',')).digest('hex')}"`;

/** The category list is a handful of rows, so it is paged in memory. */
const paginate = <T>(all: T[], { page, limit }: { page: number; limit: number }) => ({
  items: all.slice((page - 1) * limit, page * limit),
  page,
  limit,
  total: all.length,
});

export function standardsPublicRoutes(deps: ConfigHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/config/trade-standards',
      scope: 'PUBLIC',
      summary: 'The current standard of every trade category (CTS1)',
      paginated: 'page',
      rateLimit: PUBLIC_BUDGET,
      schema: { query: listQuery, response: pagedSchema(publicView) },
      handler: async ({ res, query }) => {
        const all = (await cached(res, 'no-cache', () => listCurrentStandards(deps.db()))).map(toPublicView);
        res.setHeader('ETag', etagOf(all.map((s) => s.versionId)));
        return paginate(all, query);
      },
    }),
    defineRoute({
      method: 'get',
      path: '/config/trade-standards/versions/:id',
      scope: 'PUBLIC',
      summary: 'One standard version by id: what a trade snapshotted',
      rateLimit: PUBLIC_BUDGET,
      schema: { params: versionParams, response: publicView },
      handler: async ({ res, params }) => {
        // A version never changes, so it can be cached for longer than the "current" reads.
        const version = await cached(res, 'public, max-age=3600, immutable', () =>
          getStandardVersion(deps.db(), params.id),
        );
        return toPublicView(version);
      },
    }),
    defineRoute({
      method: 'get',
      path: '/config/trade-standards/:categoryCode',
      scope: 'PUBLIC',
      summary: 'The current standard of one trade category',
      rateLimit: PUBLIC_BUDGET,
      schema: { params: categoryParams, response: publicView },
      handler: async ({ res, params }) => {
        const current = toPublicView(
          await cached(res, 'no-cache', () => getCurrentStandard(deps.db(), params.categoryCode)),
        );
        res.setHeader('ETag', `"${current.versionId}"`);
        return current;
      },
    }),
  ];
}

export function standardsAdminRoutes(deps: ConfigHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/admin/config/trade-standards',
      scope: 'STAFF',
      permission: 'config.view',
      summary: 'Every category with its current standard, including who set it and why',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: listQuery, response: pagedSchema(adminView) },
      handler: async ({ query }) => {
        const all = await listCurrentStandards(deps.db());
        const start = (query.page - 1) * query.limit;
        return {
          items: all.slice(start, start + query.limit),
          page: query.page,
          limit: query.limit,
          total: all.length,
        };
      },
    }),
    defineRoute({
      method: 'put',
      path: '/admin/config/trade-standards/:categoryCode',
      scope: 'STAFF',
      permission: 'config.manage',
      summary: 'Publish a new standard version for a category; a reason is required',
      // An identical standard writes nothing, so a repeat is safe without an idempotency key.
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: categoryParams, body: putBodySchema, response: adminView },
      handler: async (ctx) => {
        const staff = configActor(ctx.actor, ctx.req);
        const { reason: bodyReason, ...content } = ctx.body;
        const reason = requireReason(ctx.req, bodyReason);
        const { standard } = await publishStandard(deps.db(), {
          actor: staff,
          categoryCode: ctx.params.categoryCode,
          content,
          reason,
        });
        return standard;
      },
    }),
  ];
}
