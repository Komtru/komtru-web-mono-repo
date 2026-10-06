// The lifecycle vocabulary is the one design §6 reconciled, not M7's. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { enumLabels } from '../support.js';

describe.runIf(infraEnabled)('trade enums', () => {
  const t = useTestDatabase();

  it('has design §6.1 trade statuses and nothing M7 dropped', async () => {
    expect(await enumLabels(t.owner(), 'trade_status')).toEqual([
      'DRAFT',
      'PENDING_COUNTERPARTY',
      'UNDER_PROPOSAL_REVIEW',
      'AWAITING_ACCEPTANCE',
      'PENDING_PAYMENT',
      'FUNDED',
      'SHIPPED',
      'UNCONFIRMED_DELIVERY',
      'INSPECTION',
      'COMPLETED',
      'SETTLED',
      'DISPUTED',
      'RESOLVED_REFUNDED',
      'RESOLVED_RELEASED',
      'CANCELLED_REFUNDED',
      'DECLINED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED',
    ]);
  });

  it('carries every delivery-signal source including PARK_CUSTODY (C3)', async () => {
    expect(await enumLabels(t.owner(), 'delivery_signal_source')).toEqual([
      'BUYER_CONFIRMATION',
      'SELLER_SELF_REPORT',
      'PARTNER_PORTAL',
      'PARK_CUSTODY',
      'COURIER_API',
    ]);
  });

  it('names a hold source for every design §6.2 source', async () => {
    expect(await enumLabels(t.owner(), 'trade_hold_source')).toEqual(['PARK_EXCEPTION', 'RISK', 'ADMIN']);
  });

  it('names the six scheduled deadlines', async () => {
    expect(await enumLabels(t.owner(), 'trade_deadline_kind')).toEqual([
      'COUNTERPARTY_EXPIRY',
      'PAYMENT',
      'DELIVERY',
      'UNCONFIRMED_DELIVERY_GRACE',
      'INSPECTION',
      'MEDIATION',
    ]);
  });
});
