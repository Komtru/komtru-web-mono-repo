import { describe, expect, it } from 'vitest';
import {
  PARTNER_HISTORY_SOURCES,
  decideDeliverySignal,
  deliverySignalPayloadSchema,
  isTrustedSignal,
  type DeliverySignalSource,
} from '../../../../src/modules/trades/domain/deliverySignal.js';
import { TRADE_STATUSES } from '../../../../src/modules/trades/domain/stateMachine.js';

const SOURCES: DeliverySignalSource[] = [
  'BUYER_CONFIRMATION',
  'SELLER_SELF_REPORT',
  'PARTNER_PORTAL',
  'PARK_CUSTODY',
  'COURIER_API',
];

describe('trust weighting (M7 section 6)', () => {
  it.each(['BUYER_CONFIRMATION', 'PARTNER_PORTAL', 'COURIER_API', 'PARK_CUSTODY'] as const)(
    '%s is trusted on its own',
    (source) => {
      expect(isTrustedSignal(source, [])).toBe(true);
    },
  );

  it('a lone seller self-report is not trusted', () => {
    expect(isTrustedSignal('SELLER_SELF_REPORT', [])).toBe(false);
    expect(isTrustedSignal('SELLER_SELF_REPORT', ['SELLER_SELF_REPORT'])).toBe(false);
  });

  it('a buyer confirmation earlier in the history does not corroborate a seller', () => {
    expect(isTrustedSignal('SELLER_SELF_REPORT', ['BUYER_CONFIRMATION'])).toBe(false);
  });

  it.each(PARTNER_HISTORY_SOURCES)(
    'partner-history exception: %s earlier makes a self-report trusted',
    (earlier) => {
      expect(isTrustedSignal('SELLER_SELF_REPORT', ['SELLER_SELF_REPORT', earlier])).toBe(true);
    },
  );

  it('names exactly the partner, courier and custody sources as history', () => {
    expect([...PARTNER_HISTORY_SOURCES].sort()).toEqual(['COURIER_API', 'PARK_CUSTODY', 'PARTNER_PORTAL']);
  });
});

describe('what a signal does to a trade', () => {
  it('moves a shipped trade to INSPECTION on a trusted signal', () => {
    for (const source of ['BUYER_CONFIRMATION', 'PARTNER_PORTAL', 'COURIER_API', 'PARK_CUSTODY'] as const) {
      expect(decideDeliverySignal({ status: 'SHIPPED', source, priorSources: [] })).toEqual({
        kind: 'MOVE',
        action: 'DELIVERY_SIGNAL',
        to: 'INSPECTION',
      });
    }
  });

  it('parks a shipped trade at UNCONFIRMED_DELIVERY on an uncorroborated self-report', () => {
    expect(
      decideDeliverySignal({ status: 'SHIPPED', source: 'SELLER_SELF_REPORT', priorSources: [] }),
    ).toEqual({ kind: 'MOVE', action: 'DELIVERY_SIGNAL', to: 'UNCONFIRMED_DELIVERY' });
  });

  it('treats a self-report after a courier signal as trusted', () => {
    expect(
      decideDeliverySignal({
        status: 'SHIPPED',
        source: 'SELLER_SELF_REPORT',
        priorSources: ['PARTNER_PORTAL'],
      }),
    ).toMatchObject({ to: 'INSPECTION' });
  });

  it('lets only the buyer take an unconfirmed delivery to INSPECTION', () => {
    expect(
      decideDeliverySignal({
        status: 'UNCONFIRMED_DELIVERY',
        source: 'BUYER_CONFIRMATION',
        priorSources: [],
      }),
    ).toEqual({ kind: 'MOVE', action: 'CONFIRM_RECEIPT', to: 'INSPECTION' });
    for (const source of ['PARTNER_PORTAL', 'PARK_CUSTODY', 'COURIER_API', 'SELLER_SELF_REPORT'] as const) {
      expect(decideDeliverySignal({ status: 'UNCONFIRMED_DELIVERY', source, priorSources: [] }).kind).toBe(
        'RECORD_ONLY',
      );
    }
  });

  it('only records a signal in every other state', () => {
    for (const status of TRADE_STATUSES.filter((s) => s !== 'SHIPPED' && s !== 'UNCONFIRMED_DELIVERY')) {
      for (const source of SOURCES) {
        expect(decideDeliverySignal({ status, source, priorSources: [] }).kind, `${status}/${source}`).toBe(
          'RECORD_ONLY',
        );
      }
    }
  });
});

describe('the design 7.5 payload', () => {
  const base = {
    tradeId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01',
    source: 'PARK_CUSTODY',
    occurredAt: '2026-11-09T10:00:00.000Z',
    actorUserId: null,
    reference: { kind: 'PARK_PARCEL', id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a02' },
    hubId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a03',
  };

  it('accepts the documented shape', () => {
    expect(deliverySignalPayloadSchema.safeParse(base).success).toBe(true);
    expect(
      deliverySignalPayloadSchema.safeParse({
        ...base,
        source: 'BUYER_CONFIRMATION',
        reference: null,
        hubId: undefined,
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown source, a non-ISO time and a bad reference kind', () => {
    expect(deliverySignalPayloadSchema.safeParse({ ...base, source: 'CARRIER_PIGEON' }).success).toBe(false);
    expect(deliverySignalPayloadSchema.safeParse({ ...base, occurredAt: 'yesterday' }).success).toBe(false);
    expect(
      deliverySignalPayloadSchema.safeParse({ ...base, reference: { kind: 'WAYBILL', id: base.tradeId } })
        .success,
    ).toBe(false);
  });
});
