// The three deadline sweeps, as idempotent service functions. Each walks one status by one clock,
// over the partial index built for it, and moves the cases whose window has run out.
//
// Idempotent by construction: the work is a guarded transition, so a case another worker already
// moved fails its guard and is skipped rather than moved twice. That is what lets a second worker,
// a retried occurrence, or an occurrence that overran and ran twice all be harmless.
//
// Each case gets its own transaction. One sweep that moved forty cases and then hit a bad
// forty-first must not roll back the forty — a dispute left in mediation past its deadline is a
// case nobody is reviewing.
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import { closeEvidenceWindow } from './evidence.service.js';
import { lapseAppealWindow } from './appeal.service.js';
import { disputesPastDeadline } from './read.service.js';
import type { DisputePorts } from './ports.js';
import { SYSTEM_ACTOR, lockDispute, moveCase } from './transition.js';

/** How many cases one occurrence will move. A sweep is not a backfill. */
export const SWEEP_BATCH = 100;

export interface SweepDeps {
  db: Db;
  ports: DisputePorts;
  logger?: Logger | undefined;
}

interface SweepResult {
  considered: number;
  moved: number;
}

async function sweep(
  deps: SweepDeps,
  name: string,
  status: Parameters<typeof disputesPastDeadline>[1]['status'],
  clock: Parameters<typeof disputesPastDeadline>[1]['clock'],
  move: (disputeId: string) => Promise<void>,
): Promise<SweepResult> {
  const due = await disputesPastDeadline(deps.db, {
    status,
    clock,
    now: deps.ports.now(),
    limit: SWEEP_BATCH,
  });

  let moved = 0;
  for (const { id } of due) {
    try {
      await move(id);
      moved += 1;
    } catch (error) {
      // A lost guard is the normal outcome of two workers racing, not a fault. Anything else is
      // worth a line, because a case stuck past its deadline is money sitting still.
      deps.logger?.warn({ disputeId: id, sweep: name, err: error }, 'disputes: a case did not move');
    }
  }
  return { considered: due.length, moved };
}

/** C13: the parties' window ran out without an agreement, so the case goes to evidence. */
export const sweepMediationDeadlines = (deps: SweepDeps): Promise<SweepResult> =>
  sweep(deps, 'mediation', 'MEDIATION', 'mediationDeadlineAt', (disputeId) =>
    deps.db.transaction(async (tx) => {
      const row = await lockDispute(tx, disputeId);
      if (!row) return;
      await moveCase(tx, row, {
        action: 'MEDIATION_LAPSED',
        to: 'OPEN_EVIDENCE_COLLECTION',
        actor: SYSTEM_ACTOR,
        reason: 'The mediation window closed without an agreement',
      });
    }),
  );

/** M3 D2: the evidence window ran out, so the case is ready for a reviewer. */
export const sweepEvidenceDeadlines = (deps: SweepDeps): Promise<SweepResult> =>
  sweep(deps, 'evidence', 'OPEN_EVIDENCE_COLLECTION', 'evidenceDeadlineAt', (disputeId) =>
    deps.db.transaction((tx) => closeEvidenceWindow(deps.ports, tx, { disputeId, actor: SYSTEM_ACTOR })),
  );

/** M3 D5: nobody appealed, so the decision is final and the case closes itself. */
export const sweepAppealDeadlines = (deps: SweepDeps): Promise<SweepResult> =>
  sweep(deps, 'appeal', 'DECIDED', 'appealDeadlineAt', (disputeId) =>
    deps.db.transaction((tx) => lapseAppealWindow(deps.ports, tx, { disputeId, actor: SYSTEM_ACTOR })),
  );
