// F-028's routes (CWT-S12 and CWT-S13):
//
//   POST /trades/:id/evidence   attach finished uploads to the trade under an event (DISPATCH, DELIVERY, INSPECTION, ISSUE)
//   GET  /trades/:id/evidence   the evidence the parties added, oldest first, optionally for one event (cursor-paginated)
//
// Upload first, then attach: the client has already called `POST /files/upload-url` and `POST /files/:id/finalize`.
// Both routes are for the trade's parties only, through the same `requireParty` door every trade route uses.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import type { EvidenceDeps } from '../services/evidencePorts.js';
import { attachEvidence, listEvidence } from '../services/evidence.service.js';
import {
  attachEvidenceBodySchema,
  attachEvidenceResponseSchema,
  listEvidenceQuerySchema,
  listEvidenceResponseSchema,
} from './evidence.validation.js';
import { tradeIdParamSchema } from './trade.validation.js';

const SIGN_IN = 'Sign in to trade';
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);
const BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };

export function evidenceRoutes(deps: () => EvidenceDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/trades/:id/evidence',
      scope: 'CONSUMER',
      summary: 'Attach files you have uploaded to the trade as evidence of an event',
      status: 201,
      // The Idempotency-Key replays the stored response, and the service is itself a no-op for the same files.
      retryable: true,
      rateLimit: { ...BUDGET },
      schema: {
        params: tradeIdParamSchema,
        body: attachEvidenceBodySchema,
        response: attachEvidenceResponseSchema,
      },
      handler: (ctx) =>
        attachEvidence(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          event: ctx.body.event,
          fileIds: ctx.body.fileIds,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/trades/:id/evidence',
      scope: 'CONSUMER',
      summary: 'The media the parties added to the trade, by event',
      paginated: 'cursor',
      rateLimit: { points: 120, durationSeconds: 60, by: ['user', 'ip'] },
      schema: {
        params: tradeIdParamSchema,
        query: listEvidenceQuerySchema,
        response: listEvidenceResponseSchema,
      },
      handler: (ctx) =>
        listEvidence(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          event: ctx.query.event,
          limit: ctx.query.limit ?? 50,
          cursor: ctx.cursor,
        }),
    }),
  ];
}
