import { describe, expect, it } from 'vitest';
import {
  buildShipOptions,
  dispatchGuard,
  selfArrangedShipmentSchema,
} from '../../../../src/modules/trades/domain/fulfilment.js';
import { TRADE_STATUSES } from '../../../../src/modules/trades/domain/stateMachine.js';

describe('dispatch guard (X1)', () => {
  it('opens only for FUNDED', () => {
    expect(dispatchGuard('FUNDED')).toEqual({ open: true });
  });

  it.each([
    'DRAFT',
    'PENDING_COUNTERPARTY',
    'UNDER_PROPOSAL_REVIEW',
    'AWAITING_ACCEPTANCE',
    'PENDING_PAYMENT',
  ] as const)('is locked until funded in %s', (status) => {
    expect(dispatchGuard(status)).toEqual({ open: false, reason: 'DISPATCH_LOCKED' });
  });

  it('is never open in any other state, and says it is not a lock', () => {
    for (const status of TRADE_STATUSES.filter((s) => s !== 'FUNDED')) {
      const guard = dispatchGuard(status);
      expect(guard.open, status).toBe(false);
    }
    expect(dispatchGuard('SHIPPED')).toEqual({ open: false, reason: 'NOT_FUNDED_OR_ALREADY_SHIPPED' });
    expect(dispatchGuard('CANCELLED')).toEqual({ open: false, reason: 'NOT_FUNDED_OR_ALREADY_SHIPPED' });
  });
});

const company = (name: string, isDefault = false) => ({ id: `id-${name}`, name, isDefault });
const serviceable = (id: string, name: string, ok: boolean) => ({ id, name, serviceable: ok });

describe('ship options (X2, design 7.8)', () => {
  const ok = { delivery: serviceable('c1', 'Ikeja', true), shipsFrom: serviceable('c2', 'Jos', true) };

  it('pins Park first, then enabled companies in the order given, then self-arranged last', () => {
    const options = buildShipOptions({
      companies: [company('GIG'), company('Park', true), company('DHL')],
      coverage: ok,
    });
    expect(options.map((o) => o.kind)).toEqual(['PARK', 'COMPANY', 'COMPANY', 'SELF_ARRANGED']);
    expect(options.filter((o) => o.kind === 'COMPANY').map((o) => (o as { name: string }).name)).toEqual([
      'GIG',
      'DHL',
    ]);
  });

  it('offers Park when both cities are serviceable', () => {
    expect(buildShipOptions({ companies: [], coverage: ok })[0]).toMatchObject({
      kind: 'PARK',
      available: true,
      reason: null,
    });
  });

  it('still lists Park when it is not available, with the reason', () => {
    const delivery = buildShipOptions({
      companies: [],
      coverage: { ...ok, delivery: serviceable('c1', 'Jos', false) },
    })[0];
    expect(delivery).toMatchObject({
      kind: 'PARK',
      available: false,
      reason: {
        code: 'PARK_NOT_AVAILABLE_IN_CITY',
        side: 'DELIVERY',
        message: "Park isn't available in Jos yet",
      },
    });

    const origin = buildShipOptions({
      companies: [],
      coverage: { ...ok, shipsFrom: serviceable('c2', 'Yola', false) },
    })[0];
    expect(origin).toMatchObject({ available: false, reason: { side: 'SHIPS_FROM' } });

    const both = buildShipOptions({
      companies: [],
      coverage: { delivery: serviceable('c1', 'Jos', false), shipsFrom: serviceable('c2', 'Yola', false) },
    })[0];
    expect(both).toMatchObject({
      available: false,
      reason: { side: 'BOTH', message: "Park isn't available in Jos or Yola yet" },
    });
  });

  it('names one city once when both sides are the same unserviceable city', () => {
    const [park] = buildShipOptions({
      companies: [],
      coverage: { delivery: serviceable('c1', 'Jos', false), shipsFrom: serviceable('c1', 'Jos', false) },
    });
    expect(park).toMatchObject({ reason: { message: "Park isn't available in Jos yet" } });
  });

  it('is unavailable, not guessed, when a trade address has no city', () => {
    expect(
      buildShipOptions({ companies: [], coverage: { delivery: null, shipsFrom: ok.shipsFrom } })[0],
    ).toMatchObject({
      available: false,
      reason: { code: 'TRADE_ADDRESS_MISSING' },
    });
  });

  it('keeps the self-arranged option unconditionally, and lists what it needs', () => {
    const last = buildShipOptions({
      companies: [],
      coverage: { delivery: serviceable('c1', 'Jos', false), shipsFrom: serviceable('c2', 'Yola', false) },
    }).at(-1);
    expect(last).toEqual({
      kind: 'SELF_ARRANGED',
      label: 'Arrange my own shipping',
      available: true,
      requiredFields: ['waybillNumber', 'receiptFileId', 'driverPhone', 'vehiclePlate'],
    });
  });
});

describe('self-arranged shipment input (X2)', () => {
  const valid = {
    waybillNumber: ' WB-123456 ',
    receiptFileId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01',
    driverPhone: '0803 123 4567',
    vehiclePlate: ' abc-123 de ',
  };

  it('normalises the phone to E.164 and the plate to upper case', () => {
    expect(selfArrangedShipmentSchema.parse(valid)).toEqual({
      waybillNumber: 'WB-123456',
      receiptFileId: valid.receiptFileId,
      driverPhone: '+2348031234567',
      vehiclePlate: 'ABC-123 DE',
    });
  });

  it.each(['waybillNumber', 'receiptFileId', 'driverPhone', 'vehiclePlate'] as const)(
    'requires %s',
    (field) => {
      const { [field]: _omitted, ...rest } = valid;
      expect(selfArrangedShipmentSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('rejects an unparseable phone, a short waybill and a plate with punctuation', () => {
    expect(selfArrangedShipmentSchema.safeParse({ ...valid, driverPhone: '12' }).success).toBe(false);
    expect(selfArrangedShipmentSchema.safeParse({ ...valid, waybillNumber: 'ab' }).success).toBe(false);
    expect(selfArrangedShipmentSchema.safeParse({ ...valid, vehiclePlate: 'AB!<>' }).success).toBe(false);
  });
});
