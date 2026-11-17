// F-028 (CWT-S13): request and response shapes for the evidence routes.
import { paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { MAX_FILES_PER_ATTACH, TRADE_EVIDENCE_EVENTS } from '../domain/evidence.js';

export const evidenceEventSchema = z.enum(TRADE_EVIDENCE_EVENTS);

export const attachEvidenceBodySchema = z.strictObject({
  event: evidenceEventSchema,
  /** Finished uploads: `POST /files/upload-url`, then `POST /files/:id/finalize`, then the id here. */
  fileIds: z.array(z.uuid()).min(1).max(MAX_FILES_PER_ATTACH),
});

export const listEvidenceQuerySchema = z.object({ event: evidenceEventSchema.optional() });

export const evidenceItemSchema = z.object({
  id: z.uuid(),
  fileId: z.uuid(),
  event: evidenceEventSchema,
  attachedByRole: z.enum(['BUYER', 'SELLER']),
  attachedAt: z.iso.datetime(),
});

export const attachEvidenceResponseSchema = z.object({ evidence: z.array(evidenceItemSchema) });
export const listEvidenceResponseSchema = paginatedSchema(evidenceItemSchema);
