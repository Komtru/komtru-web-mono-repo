// What inspection and completion need from modules that do not exist yet, as ports (T-065), in the
// style of fulfilmentPorts.ts. Kept apart from TradeDeps and FulfilmentDeps so their fixtures did
// not change.
import type { Db } from '../../../db/index.js';
import type { Tx } from '../../../platform/events/publish.js';

export interface InspectionDeps {
  db: Db;
  /**
   * Is there an open dispute on this trade? AR1 and M7 §6 both stop an automatic transition for one.
   * SEAM(T-080): the dispute service does not exist, so the production adapter answers no. T-080
   * replaces `noDisputes` with a read of its open cases, and nothing else here changes.
   */
  disputes: { hasOpenDispute: (tx: Tx, tradeId: string) => Promise<boolean> };
  now: () => Date;
}

/**
 * SEAM(T-080). There are no disputes to find. Opening one moves the trade to `DISPUTED` (design
 * §6.2), which the sweeps already treat as "someone else owns it", so until T-080 the machine's own
 * status is the only guard and this port is where the case-level check plugs in.
 */
export const noDisputes: InspectionDeps['disputes'] = {
  hasOpenDispute: () => Promise.resolve(false),
};
