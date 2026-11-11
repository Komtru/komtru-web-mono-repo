// The refund and cancellation lists are declared twice — as Postgres enums in the schema and as the
// shared contract the screens read — and must not drift apart.
import * as shared from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import {
  refundScope,
  refundStatus,
} from '../../../src/modules/ledger/infrastructure/postgres/schema/refunds.js';
import {
  cancellationRequestReason,
  cancellationRequestStatus,
} from '../../../src/modules/trades/infrastructure/postgres/schema/cancellation.js';

describe('the refund vocabulary (T-066, T-075)', () => {
  it('is the same in the schema and in shared-types', () => {
    expect([...refundStatus.enumValues]).toEqual([...shared.REFUND_STATUSES]);
    expect([...refundScope.enumValues]).toEqual([...shared.REFUND_SCOPES]);
    expect([...cancellationRequestStatus.enumValues]).toEqual([...shared.CANCELLATION_REQUEST_STATUSES]);
    expect([...cancellationRequestReason.enumValues]).toEqual([
      ...shared.BUYER_CANCELLATION_REASONS,
      ...shared.SELLER_CANCELLATION_REASONS,
    ]);
  });
});
