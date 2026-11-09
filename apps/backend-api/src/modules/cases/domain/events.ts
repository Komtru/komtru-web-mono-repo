// What the case index publishes, through the transactional outbox.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';
import { CASE_PRIORITIES, CASE_TYPES } from './types.js';

const caseRef = {
  caseId: z.uuid(),
  caseNumber: z.number().int().positive(),
  type: z.enum(CASE_TYPES),
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
};

export const caseRegistered = defineEvent(
  'cases.case.registered',
  1,
  z.object({ ...caseRef, priority: z.enum(CASE_PRIORITIES), slaDueAt: z.iso.datetime() }),
);

/** A case was taken or reassigned. `fromUserId` is null for an unowned case. */
export const caseAssigned = defineEvent(
  'cases.case.assigned',
  1,
  z.object({
    ...caseRef,
    fromUserId: z.uuid().nullable(),
    toUserId: z.uuid(),
    reason: z.string().nullable(),
  }),
);

export const caseEscalated = defineEvent(
  'cases.case.escalated',
  1,
  z.object({ ...caseRef, reason: z.string() }),
);

/**
 * A person decided. The owning module executes the outcome (refund, approval, restriction) and then
 * closes the case; the outcome is theirs to interpret, this index only carries it.
 */
export const caseDecided = defineEvent(
  'cases.case.decided',
  1,
  z.object({
    ...caseRef,
    decisionId: z.uuid(),
    outcome: z.string(),
    policyCitation: z.string(),
    decidedByUserId: z.uuid(),
  }),
);

export const caseClosed = defineEvent(
  'cases.case.closed',
  1,
  z.object({ ...caseRef, outcome: z.string().nullable() }),
);
