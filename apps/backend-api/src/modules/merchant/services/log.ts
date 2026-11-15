import type { Tx } from '../../../platform/events/publish.js';
import type { ChangeItem } from '../domain/application.js';
import type { MerchantApplicationStatus } from '../domain/status.js';
import { merchantApplicationEvents } from '../infrastructure/postgres/schema/applications.js';
import type { EventActorType } from '../infrastructure/postgres/schema/enums.js';

export interface LogInput {
  applicationId: string;
  from: MerchantApplicationStatus | null;
  to: MerchantApplicationStatus;
  actorType: EventActorType;
  actorUserId?: string | null;
  reason?: string | null;
  policyCitation?: string | null;
  requested?: ChangeItem[];
  detail?: Record<string, unknown>;
}

/**
 * One row of the append-only status and decision log. The table's CHECK refuses a staff decision with no
 * reason or citation, so a caller that forgets one fails here, in the transaction that made the change.
 */
export const logEvent = async (tx: Tx, input: LogInput): Promise<void> => {
  await tx.insert(merchantApplicationEvents).values({
    applicationId: input.applicationId,
    fromStatus: input.from,
    toStatus: input.to,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    reason: input.reason ?? null,
    policyCitation: input.policyCitation ?? null,
    detail: {
      ...(input.requested && input.requested.length > 0 ? { requested: input.requested } : {}),
      ...input.detail,
    },
  });
};
