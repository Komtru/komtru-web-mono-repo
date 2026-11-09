// The ship step's rules, pure (T-064): when dispatch is open (X1), what the seller is offered and
// why Park may not be (X2, design §7.8), and the evidence a self-arranged shipment must carry.
// The server decides every one of these; the client renders what it is told and never works out
// availability for itself.
import { uuidSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { normalisePhone } from '../../../platform/identifiers.js';
import type { TradeStatus } from './stateMachine.js';

export type DispatchGuard =
  { open: true } | { open: false; reason: 'DISPATCH_LOCKED' | 'NOT_FUNDED_OR_ALREADY_SHIPPED' };

/** Statuses before escrow is funded: the seller is told to wait (X1), not that the step is invalid. */
const BEFORE_FUNDING: readonly TradeStatus[] = [
  'DRAFT',
  'PENDING_COUNTERPARTY',
  'UNDER_PROPOSAL_REVIEW',
  'AWAITING_ACCEPTANCE',
  'PENDING_PAYMENT',
];

/** X1: shipping is possible in exactly one state. Everything else is a 409, with the reason apart. */
export const dispatchGuard = (status: TradeStatus): DispatchGuard =>
  status === 'FUNDED'
    ? { open: true }
    : {
        open: false,
        reason: BEFORE_FUNDING.includes(status) ? 'DISPATCH_LOCKED' : 'NOT_FUNDED_OR_ALREADY_SHIPPED',
      };

export interface EnabledCompany {
  id: string;
  name: string;
  /** Park is the one company with `is_default`, pinned first (design §7.1). */
  isDefault: boolean;
}

export interface CityCoverage {
  id: string;
  name: string;
  serviceable: boolean;
}

export type ParkUnavailable =
  | {
      code: 'PARK_NOT_AVAILABLE_IN_CITY';
      side: 'DELIVERY' | 'SHIPS_FROM' | 'BOTH';
      cities: { side: 'DELIVERY' | 'SHIPS_FROM'; cityId: string; name: string }[];
      message: string;
    }
  | { code: 'TRADE_ADDRESS_MISSING'; message: string };

export const SELF_ARRANGED_FIELDS = [
  'waybillNumber',
  'receiptFileId',
  'driverPhone',
  'vehiclePlate',
] as const;

export type ShipOption =
  | { kind: 'PARK'; label: string; available: boolean; reason: ParkUnavailable | null }
  | { kind: 'COMPANY'; companyId: string; name: string; available: true }
  | {
      kind: 'SELF_ARRANGED';
      label: string;
      available: true;
      requiredFields: readonly (typeof SELF_ARRANGED_FIELDS)[number][];
    };

function parkAvailability(coverage: {
  delivery: CityCoverage | null;
  shipsFrom: CityCoverage | null;
}): ParkUnavailable | null {
  const { delivery, shipsFrom } = coverage;
  if (!delivery || !shipsFrom) {
    return {
      code: 'TRADE_ADDRESS_MISSING',
      message: 'Park needs both the delivery and ships-from cities, and this trade is missing one.',
    };
  }
  // Both cities must be serviceable: the seller drops the parcel at a hub in the ships-from city
  // and the buyer collects from one in the delivery city (design §7.8, Q15).
  const blocked = [
    ...(delivery.serviceable
      ? []
      : [{ side: 'DELIVERY' as const, cityId: delivery.id, name: delivery.name }]),
    ...(shipsFrom.serviceable
      ? []
      : [{ side: 'SHIPS_FROM' as const, cityId: shipsFrom.id, name: shipsFrom.name }]),
  ];
  if (blocked.length === 0) return null;
  const names = [...new Set(blocked.map((city) => city.name))];
  return {
    code: 'PARK_NOT_AVAILABLE_IN_CITY',
    side: blocked.length === 2 ? 'BOTH' : blocked[0]!.side,
    cities: blocked,
    message: `Park isn't available in ${names.join(' or ')} yet`,
  };
}

/**
 * Park pinned first (always listed, so the client can show it disabled with the reason), then every
 * enabled non-Park company in the order supplied, then the permanent self-arranged option (m2 §10).
 * A company the port reports as the default is Park's own row and is not listed twice.
 */
export function buildShipOptions(input: {
  companies: readonly EnabledCompany[];
  coverage: { delivery: CityCoverage | null; shipsFrom: CityCoverage | null };
}): ShipOption[] {
  const reason = parkAvailability(input.coverage);
  return [
    { kind: 'PARK', label: 'Park Hub Transit', available: reason === null, reason },
    ...input.companies
      .filter((company) => !company.isDefault)
      .map((company): ShipOption => ({
        kind: 'COMPANY',
        companyId: company.id,
        name: company.name,
        available: true,
      })),
    {
      kind: 'SELF_ARRANGED',
      label: 'Arrange my own shipping',
      available: true,
      requiredFields: SELF_ARRANGED_FIELDS,
    },
  ];
}

const phone = z.string().transform((raw, ctx) => {
  const parsed = normalisePhone(raw);
  if (!parsed) {
    ctx.addIssue({ code: 'custom', message: 'Enter the driver or rider phone number' });
    return z.NEVER;
  }
  return parsed.phoneE164;
});

/** X2's four fields, all required. The receipt photo's ownership is checked by the service. */
export const selfArrangedShipmentSchema = z.object({
  waybillNumber: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/, 'Use letters, digits and - / . _ only'),
  receiptFileId: uuidSchema,
  driverPhone: phone,
  vehiclePlate: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase().replace(/\s+/g, ' '))
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9 -]{2,13}$/, 'Enter the vehicle registration plate')),
});
export type SelfArrangedShipmentInput = z.infer<typeof selfArrangedShipmentSchema>;
