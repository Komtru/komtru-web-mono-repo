// The screen suites answer `client.call` with fixtures. The real client parses each response with the endpoint's
// own schema, and a mock that skipped that would let a fixture (and so a screen) drift from the platform's
// contract with every test still green. Two defences: `answerWith` parses with the same schema (so any suite
// fails on drift), and this file pins the shared fixtures against the real schemas and against the contract
// shared with the backend, so a field the platform adds or renames fails here by name.
import {
  getDeliveryDeadline,
  getInspection,
  getTrade,
  getTradeByCode,
  listTradeActivity,
  listTrades,
} from '@komtru/api-client';
import { tradeActivityItemSchema, tradeActivityResponseSchema } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import {
  FEES,
  activityRow,
  deliveryDeadline,
  inspectionRead,
  listItem,
  tradeView,
  workspaceTrade,
} from './support/workspace';

const STATUSES = [
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
];

const problems = (result: { success: boolean; error?: { issues: unknown[] } }) =>
  result.success ? 'ok' : JSON.stringify(result.error?.issues);

describe('the fixtures are what the platform sends', () => {
  it.each(
    STATUSES.flatMap((status) => (['BUYER', 'SELLER'] as const).map((role) => [status, role] as const)),
  )('a %s trade seen as the %s parses with the real trade schema', (status, role) => {
    expect(problems(getTrade.schema.response.safeParse(workspaceTrade(status, role)))).toBe('ok');
  });

  it('a proposal parses, and so does a list row and the fee snapshot', () => {
    expect(problems(getTrade.schema.response.safeParse(tradeView()))).toBe('ok');
    expect(problems(listTrades.schema.response.safeParse({ items: [listItem(1)], nextCursor: null }))).toBe(
      'ok',
    );
    expect(Object.keys(FEES).sort()).toEqual([
      'buyerProtectionFeeMinor',
      'buyerTotalMinor',
      'commissionMinor',
      'itemAmountMinor',
      'scheduleVersion',
      'sellerProceedsMinor',
    ]);
  });

  it('the activity rows parse with the strict shared schema, and one more field would not', () => {
    expect(
      problems(tradeActivityResponseSchema.safeParse({ items: [activityRow(1)], nextCursor: null })),
    ).toBe('ok');
    expect(
      problems(listTradeActivity.schema.response.safeParse({ items: [activityRow(1)], nextCursor: null })),
    ).toBe('ok');
    expect(tradeActivityItemSchema.safeParse({ ...activityRow(1), summary: 'internal' }).success).toBe(false);
  });

  it('the deadline and the inspection read parse with the real endpoint schemas', () => {
    expect(problems(getDeliveryDeadline.schema.response.safeParse(deliveryDeadline()))).toBe('ok');
    expect(problems(getInspection.schema.response.safeParse(inspectionRead()))).toBe('ok');
    expect(
      problems(
        getInspection.schema.response.safeParse(inspectionRead({ deliveryEvidence: { selfArranged: null } })),
      ),
    ).toBe('ok');
  });

  it('a lookup by code parses with the real schema', () => {
    const lookup = {
      access: 'PARTY',
      trade: {
        id: tradeView().id,
        tradeCode: 'KMT-9042800-NG',
        status: 'AWAITING_ACCEPTANCE',
        statusRevision: 1,
        yourRole: 'SELLER',
        categoryCode: null,
        categoryName: null,
        standardVersion: null,
        standardVersionId: null,
      },
      counterparty: null,
    };
    expect(problems(getTradeByCode.schema.response.safeParse(lookup))).toBe('ok');
  });

  it('the schemas do catch drift: a trade missing a field the platform sends does not parse', () => {
    const { fees: _fees, ...without } = workspaceTrade('FUNDED');
    void _fees;
    expect(getTrade.schema.response.safeParse(without).success).toBe(false);
    expect(
      getTradeByCode.schema.response.safeParse({
        access: 'PARTY',
        trade: { id: tradeView().id, tradeCode: 'KMT-9042800-NG' },
        counterparty: null,
      }).success,
    ).toBe(false);
  });
});
