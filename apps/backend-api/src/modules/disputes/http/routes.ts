// The dispute HTTP surface (M3 §9, widened by the party-facing screens F-032 builds).
//
//   POST /trades/:id/dispute                            C7/CWT-S14: file one (Path A)
//   GET  /trades/:id/dispute                            the workspace's DISPUTED body
//   GET  /disputes                                      a party's own cases, paginated
//   GET  /disputes/:id                                  C8/CWT-S15/H1/H2
//   GET  /disputes/:id/timeline                         C8's step rail
//   GET  /disputes/:id/evidence                         the case's evidence, paginated
//   GET  /disputes/:id/evidence-comparison              Y1 (T-081)
//   POST /disputes/:id/evidence                         S8/CWT-S13: add to the record
//   POST /disputes/:id/mediation/proposals              Y1's "Submit for mediation"
//   POST /disputes/:id/mediation/proposals/:pid/respond accept or decline
//   POST /disputes/:id/withdraw                         SP-M23
//   POST /disputes/:id/appeal                           AC6
//   POST /internal/disputes                             Path B, M10's escalation
//   GET  /admin/disputes/queue                          the reviewer queue
//   POST /admin/disputes/:id/assign | decide | appeal-decide | reopen-evidence
//
// RBAC NOTE, and it is not an oversight: the party routes name NO permission. M3 §8 catalogues
// `dispute.submit_evidence` and `dispute.appeal`, but the RBAC matrix grants them to no staff
// role on purpose — they belong to the buyer and seller on their own case. Declaring them on a
// CONSUMER route would 403 every real user. Party membership is checked in the service, against
// the case's own buyer and seller ids, which is the only place it can be checked correctly.
import { eq } from 'drizzle-orm';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { disputeCases } from '../infrastructure/postgres/schema/disputes.js';
import { toDisputeView } from '../services/views.js';
import { decideAppeal, fileAppeal } from '../services/appeal.service.js';
import { disputeForTrade, openDispute, withdrawDispute } from '../services/dispute.service.js';
import {
  evidenceComparison,
  listDisputeEvidence,
  reopenEvidenceWindow,
  submitEvidence,
} from '../services/evidence.service.js';
import { proposeMediation, respondToMediation } from '../services/mediation.service.js';
import {
  disputeTimeline,
  getDispute,
  listDisputesForUser,
  listReviewerQueue,
} from '../services/read.service.js';
import { assignReviewer, decideDispute } from '../services/review.service.js';
import { me, requestActor, requireReason, staffActor, type DisputesHttpDeps } from './context.js';
import {
  appealBody,
  appealDecideBody,
  assignBody,
  comparisonResponse,
  decideBody,
  decisionResponse,
  disputeDetail,
  disputeListResponse,
  disputeView,
  evidenceListResponse,
  evidenceView,
  idParams,
  listQuery,
  mediationResponse,
  openDisputeBody,
  openInternalBody,
  proposalParams,
  proposalView,
  proposeBody,
  queueQuery,
  reopenEvidenceBody,
  respondBody,
  submitEvidenceBody,
  timelineResponse,
  tradeIdParams,
  withdrawBody,
} from './validations.js';

const by = ['user', 'ip'] as ('user' | 'ip')[];
/** A dispute list is re-read on every push and every focus. */
const LIST_BUDGET = { points: 120, durationSeconds: 60, by };
/** Filing, proposing, appealing, withdrawing: attempt-shaped, so tight. */
const ACTION_BUDGET = { points: 30, durationSeconds: 60, by };
/** Evidence is attached one file at a time, so it gets a little more room than an action. */
const EVIDENCE_BUDGET = { points: 60, durationSeconds: 60, by };
const STAFF_READ_BUDGET = { points: 240, durationSeconds: 60, by };
const STAFF_WRITE_BUDGET = { points: 60, durationSeconds: 60, by };

const VIEW = 'dispute.view';
const ASSIGN = 'dispute.assign';
const DECIDE = 'dispute.decide';
const DECIDE_APPEAL = 'dispute.decide_appeal';
const ESCALATE = 'ticket.escalate_to_dispute';

export function disputeRoutes(deps: DisputesHttpDeps): RouteDefinition[] {
  const tx = <T>(
    run: (tx: Parameters<Parameters<ReturnType<DisputesHttpDeps['db']>['transaction']>[0]>[0]) => Promise<T>,
  ) => deps.db().transaction(run);

  return [
    // ------------------------------------------------------------ party: filing and reading
    defineRoute({
      method: 'post',
      path: '/trades/:id/dispute',
      scope: 'CONSUMER',
      summary: 'Report an issue on a trade and open a dispute',
      status: 201,
      // A flaky connection retrying this must not open a second case. The partial unique index
      // would refuse it anyway, but the key replays the first answer instead of a 409.
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParams, body: openDisputeBody, response: disputeView },
      handler: (ctx) =>
        tx((t) =>
          openDispute(deps.ports(), t, {
            tradeId: ctx.params.id,
            openedByUserId: me(ctx.actor),
            category: ctx.body.category as Parameters<typeof openDispute>[2]['category'],
            reason: ctx.body.reason,
            creationPath: 'DIRECT_FILING',
            actor: requestActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/trades/:id/dispute',
      scope: 'CONSUMER',
      summary: 'The dispute on this trade, if there is one',
      rateLimit: { ...LIST_BUDGET },
      schema: { params: tradeIdParams, response: disputeView.nullable() },
      handler: (ctx) => disputeForTrade(deps.db(), { tradeId: ctx.params.id, userId: me(ctx.actor) }),
    }),

    defineRoute({
      method: 'get',
      path: '/disputes',
      scope: 'CONSUMER',
      summary: 'The disputes you are a party to, newest first',
      paginated: 'cursor',
      rateLimit: { ...LIST_BUDGET },
      schema: { query: listQuery, response: disputeListResponse },
      handler: (ctx) =>
        listDisputesForUser(deps.db(), {
          userId: me(ctx.actor),
          status: ctx.query.status,
          limit: ctx.query.limit ?? 20,
          cursor: ctx.cursor,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/disputes/:id',
      scope: 'CONSUMER',
      summary: 'One dispute, with its decisions and mediation offers',
      rateLimit: { ...LIST_BUDGET },
      schema: { params: idParams, response: disputeDetail },
      handler: (ctx) => getDispute(deps.db(), { disputeId: ctx.params.id, userId: me(ctx.actor) }),
    }),

    defineRoute({
      method: 'get',
      path: '/disputes/:id/timeline',
      scope: 'CONSUMER',
      summary: 'Every move the case has made, oldest first',
      paginated: 'cursor',
      rateLimit: { ...LIST_BUDGET },
      schema: { params: idParams, response: timelineResponse },
      handler: (ctx) =>
        disputeTimeline(deps.db(), {
          disputeId: ctx.params.id,
          userId: me(ctx.actor),
          limit: ctx.query.limit ?? 50,
          cursor: ctx.cursor,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/disputes/:id/evidence',
      scope: 'CONSUMER',
      summary: 'The evidence on this case, oldest first',
      paginated: 'cursor',
      rateLimit: { ...LIST_BUDGET },
      schema: { params: idParams, response: evidenceListResponse },
      handler: (ctx) =>
        tx((t) =>
          listDisputeEvidence(t, {
            disputeId: ctx.params.id,
            userId: me(ctx.actor),
            limit: ctx.query.limit ?? 20,
            cursor: ctx.cursor,
          }),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/disputes/:id/evidence-comparison',
      scope: 'CONSUMER',
      summary: 'Y1: the seller’s pre-shipment proof beside the buyer’s unboxing photos',
      rateLimit: { ...LIST_BUDGET },
      schema: { params: idParams, response: comparisonResponse },
      handler: (ctx) =>
        tx((t) => evidenceComparison(deps.ports(), t, { disputeId: ctx.params.id, userId: me(ctx.actor) })),
    }),

    // ------------------------------------------------------------ party: acting on the case
    defineRoute({
      method: 'post',
      path: '/disputes/:id/evidence',
      scope: 'CONSUMER',
      summary: 'Add a photo or an account of what happened to the case',
      status: 201,
      retryable: true,
      rateLimit: { ...EVIDENCE_BUDGET },
      schema: { params: idParams, body: submitEvidenceBody, response: evidenceView },
      handler: (ctx) =>
        tx((t) =>
          submitEvidence(deps.ports(), t, {
            disputeId: ctx.params.id,
            userId: me(ctx.actor),
            fileRefId: ctx.body.fileRefId ?? null,
            note: ctx.body.note ?? null,
            actor: requestActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/disputes/:id/mediation/proposals',
      scope: 'CONSUMER',
      summary: 'Offer the other party a settlement',
      status: 201,
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: idParams, body: proposeBody, response: proposalView },
      handler: (ctx) =>
        tx((t) =>
          proposeMediation(deps.ports(), t, {
            disputeId: ctx.params.id,
            userId: me(ctx.actor),
            outcome: ctx.body.outcome,
            amounts: {
              toBuyerMinor: BigInt(ctx.body.amountToBuyerMinor),
              toSellerMinor: BigInt(ctx.body.amountToSellerMinor),
            },
            note: ctx.body.note ?? null,
            actor: requestActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/disputes/:id/mediation/proposals/:proposalId/respond',
      scope: 'CONSUMER',
      summary: 'Accept or decline the other party’s settlement offer',
      // Accepting moves money. A retry must replay the first answer, never agree twice.
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: proposalParams, body: respondBody, response: mediationResponse },
      handler: (ctx) =>
        tx((t) =>
          respondToMediation(deps.ports(), t, {
            disputeId: ctx.params.id,
            proposalId: ctx.params.proposalId,
            userId: me(ctx.actor),
            accept: ctx.body.accept,
            actor: requestActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/disputes/:id/withdraw',
      scope: 'CONSUMER',
      summary: 'SP-M23: close a dispute you opened',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: idParams, body: withdrawBody, response: disputeView },
      handler: (ctx) =>
        tx((t) =>
          withdrawDispute(deps.ports(), t, {
            disputeId: ctx.params.id,
            userId: me(ctx.actor),
            reason: ctx.body.reason,
            actor: requestActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/disputes/:id/appeal',
      scope: 'CONSUMER',
      summary: 'AC6: appeal a decision, once, inside the window',
      status: 201,
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: idParams, body: appealBody, response: disputeView },
      handler: (ctx) =>
        tx((t) =>
          fileAppeal(deps.ports(), t, {
            disputeId: ctx.params.id,
            userId: me(ctx.actor),
            reason: ctx.body.reason,
            actor: requestActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    // ------------------------------------------------------------ internal: Path B
    defineRoute({
      method: 'post',
      path: '/internal/disputes',
      scope: 'STAFF',
      permission: ESCALATE,
      summary: 'Open a dispute from a support ticket (M3 D1, Path B)',
      status: 201,
      retryable: true,
      rateLimit: { ...STAFF_WRITE_BUDGET },
      schema: { body: openInternalBody, response: disputeView },
      handler: (ctx) =>
        tx((t) =>
          openDispute(deps.ports(), t, {
            tradeId: ctx.body.tradeId,
            openedByUserId: ctx.body.openedByUserId,
            category: ctx.body.category,
            reason: ctx.body.reason,
            creationPath: ctx.body.creationPath,
            sourceTicketId: ctx.body.sourceTicketId ?? null,
            actor: staffActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    // ------------------------------------------------------------ reviewer
    defineRoute({
      method: 'get',
      path: '/admin/disputes/queue',
      scope: 'STAFF',
      permission: VIEW,
      summary: 'The reviewer queue: all, mine, unassigned or appeals — oldest first',
      paginated: 'cursor',
      rateLimit: { ...STAFF_READ_BUDGET },
      schema: { query: queueQuery, response: disputeListResponse },
      handler: (ctx) =>
        listReviewerQueue(deps.db(), {
          view: ctx.query.view,
          reviewerId: me(ctx.actor),
          q: ctx.query.q,
          limit: ctx.query.limit ?? 20,
          cursor: ctx.cursor,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/disputes/:id/assign',
      scope: 'STAFF',
      permission: ASSIGN,
      summary: 'Put a case in front of a reviewer who is not a party to it',
      retryable: true,
      rateLimit: { ...STAFF_WRITE_BUDGET },
      schema: { params: idParams, body: assignBody, response: disputeView },
      handler: (ctx) =>
        tx((t) =>
          assignReviewer(deps.ports(), t, {
            disputeId: ctx.params.id,
            reviewerId: ctx.body.reviewerId,
            actor: staffActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/disputes/:id/decide',
      scope: 'STAFF',
      permission: DECIDE,
      summary: 'Record the decision: an outcome, two amounts and the reasoning',
      status: 201,
      retryable: true,
      rateLimit: { ...STAFF_WRITE_BUDGET },
      schema: { params: idParams, body: decideBody, response: decisionResponse },
      handler: (ctx) =>
        tx((t) =>
          decideDispute(deps.ports(), t, {
            disputeId: ctx.params.id,
            reviewerId: me(ctx.actor),
            outcome: ctx.body.outcome,
            amounts: {
              toBuyerMinor: BigInt(ctx.body.amountToBuyerMinor),
              toSellerMinor: BigInt(ctx.body.amountToSellerMinor),
            },
            rationale: ctx.body.rationale,
            actor: staffActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/disputes/:id/appeal-decide',
      scope: 'STAFF',
      permission: DECIDE_APPEAL,
      summary: 'Uphold or overturn a decision — the final word',
      status: 201,
      retryable: true,
      rateLimit: { ...STAFF_WRITE_BUDGET },
      schema: { params: idParams, body: appealDecideBody, response: decisionResponse },
      handler: (ctx) =>
        tx((t) =>
          decideAppeal(deps.ports(), t, {
            disputeId: ctx.params.id,
            leadId: me(ctx.actor),
            appealOutcome: ctx.body.appealOutcome,
            ...(ctx.body.outcome ? { outcome: ctx.body.outcome } : {}),
            ...(ctx.body.amountToBuyerMinor !== undefined && ctx.body.amountToSellerMinor !== undefined
              ? {
                  amounts: {
                    toBuyerMinor: BigInt(ctx.body.amountToBuyerMinor),
                    toSellerMinor: BigInt(ctx.body.amountToSellerMinor),
                  },
                }
              : {}),
            rationale: ctx.body.rationale,
            actor: staffActor(ctx.actor, ctx.req),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/disputes/:id/reopen-evidence',
      scope: 'STAFF',
      permission: DECIDE,
      summary: 'M3 D2: let late evidence in, on the record',
      retryable: true,
      rateLimit: { ...STAFF_WRITE_BUDGET },
      schema: { params: idParams, body: reopenEvidenceBody, response: disputeView.nullable() },
      handler: (ctx) =>
        tx(async (t) => {
          await reopenEvidenceWindow(deps.ports(), t, {
            disputeId: ctx.params.id,
            reason: requireReason(ctx.req, ctx.body.reason),
            actor: staffActor(ctx.actor, ctx.req),
          });
          return getDisputeForStaff(deps, ctx.params.id);
        }),
    }),
  ];
}

/** A reviewer is not a party, so the party-scoped read would refuse them. */
async function getDisputeForStaff(deps: DisputesHttpDeps, disputeId: string) {
  const [row] = await deps.db().select().from(disputeCases).where(eq(disputeCases.id, disputeId));
  return row ? toDisputeView(row) : null;
}
