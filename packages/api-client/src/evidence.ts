// Evidence on a live trade (F-028, CWT-S12 and CWT-S13). Mirrors
// `apps/backend-api/src/modules/trades/http/evidence.routes.ts` field for field.
//
// The flow is upload first (`uploadFile` in files.ts: signed ticket, straight to storage, finalize), then attach the
// resulting file id here under an event. The platform never sees the bytes.
import { cursorPageRequestSchema, paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

const tradeParams = z.object({ id: z.uuid() });

/** What a piece of evidence shows. The seller's listing proof is kept apart (`sellerProof` on the inspection read). */
export const EVIDENCE_EVENTS = ['DISPATCH', 'DELIVERY', 'INSPECTION', 'ISSUE'] as const;
export const evidenceEventSchema = z.enum(EVIDENCE_EVENTS);
export type EvidenceEvent = z.infer<typeof evidenceEventSchema>;

/**
 * What can be attached as evidence: the types the files module stores for the category evidence is uploaded under
 * (photos and PDF; video is not stored). The screen offers exactly these. `test/evidence.test.ts` checks the set
 * against the platform's own `ALLOWED_CONTENT_TYPES`, so the two cannot drift apart unseen.
 */
export const EVIDENCE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** At most this many files per attach call, and per event on a trade. */
export const MAX_EVIDENCE_PER_ATTACH = 10;
export const MAX_EVIDENCE_PER_EVENT = 20;

export const evidenceItemSchema = z.looseObject({
  id: z.uuid(),
  fileId: z.uuid(),
  event: evidenceEventSchema,
  attachedByRole: z.enum(['BUYER', 'SELLER']),
  attachedAt: z.string(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

/**
 * Who may add what, as the platform enforces it: dispatch is the seller's, inspection the buyer's, delivery and
 * issue either side's. The platform refuses the rest; a screen offers only these.
 */
export const evidenceEventsFor = (role: 'BUYER' | 'SELLER'): readonly EvidenceEvent[] =>
  EVIDENCE_EVENTS.filter((event) => event !== (role === 'BUYER' ? 'DISPATCH' : 'INSPECTION'));

/** The trade statuses in which evidence can be added; the platform answers 409 otherwise. */
export const EVIDENCE_OPEN_STATUSES = ['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'DISPUTED'] as const;

/**
 * Attach finished uploads to a trade under an event. 409 `FILE_PROCESSING` (a problem extension `reason`) means a file
 * is still landing: wait and send the same call again. A repeat of the same call is harmless.
 */
export const attachEvidence = defineEndpoint({
  method: 'post',
  path: '/trades/:id/evidence',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({
      event: evidenceEventSchema,
      fileIds: z.array(z.uuid()).min(1).max(MAX_EVIDENCE_PER_ATTACH),
    }),
    response: z.looseObject({ evidence: z.array(evidenceItemSchema) }),
  },
});

/** The media the parties added, oldest first, for one event or all. */
export const listTradeEvidence = defineEndpoint({
  method: 'get',
  path: '/trades/:id/evidence',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: {
    params: tradeParams,
    query: cursorPageRequestSchema.extend({ event: evidenceEventSchema.optional() }),
    response: paginatedSchema(evidenceItemSchema),
  },
});
