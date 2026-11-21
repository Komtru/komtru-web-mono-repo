// F-065: what the logistics portal reads, for the two courier personas. One fixture company, Swift
// Couriers, with a roster that draws every state the Team screen has: active members, a member who has
// not signed in yet, an invitation to someone with no account, and an expired one.
import {
  getLogisticsMe,
  listLogisticsInvitations,
  listLogisticsMembers,
  type LogisticsInvitation,
  type LogisticsMe,
  type LogisticsMember,
} from '@komtru/api-client';

import { PERSONAS, type CourierPersonaId, type PersonaId } from './personas.ts';

const COMPANY = {
  id: '0190b0a0-0000-7000-8000-000000000a01',
  name: 'Swift Couriers',
  status: 'ENABLED' as const,
  isDefault: false,
  createdAt: '2026-10-01T09:00:00.000Z',
};

const MEMBERS: readonly LogisticsMember[] = [
  {
    id: '0190b0a0-0000-7000-8000-000000000a11',
    name: PERSONAS['courier-admin'].displayName,
    contactMasked: 'c•••@swiftcouriers.ng',
    role: 'ADMIN',
    status: 'ACTIVE',
    invitedAt: '2026-10-01T09:00:00.000Z',
    acceptedAt: '2026-10-01T10:12:00.000Z',
    removedAt: null,
  },
  {
    id: '0190b0a0-0000-7000-8000-000000000a12',
    name: PERSONAS['courier-operator'].displayName,
    contactMasked: '+23480•••2211',
    role: 'OPERATOR',
    status: 'ACTIVE',
    invitedAt: '2026-10-03T09:00:00.000Z',
    acceptedAt: '2026-10-03T11:40:00.000Z',
    removedAt: null,
  },
  {
    id: '0190b0a0-0000-7000-8000-000000000a13',
    name: 'Emeka Obi',
    contactMasked: 'e•••@gmail.com',
    role: 'OPERATOR',
    status: 'INVITED',
    invitedAt: '2026-11-18T14:05:00.000Z',
    acceptedAt: null,
    removedAt: null,
  },
];

const INVITATIONS: readonly LogisticsInvitation[] = [
  {
    id: '0190b0a0-0000-7000-8000-000000000a21',
    role: 'OPERATOR',
    channel: 'PHONE',
    contactMasked: '+23490•••7788',
    status: 'PENDING',
    invitedAt: '2026-11-17T08:30:00.000Z',
    expiresAt: '2026-11-24T08:30:00.000Z',
  },
  {
    id: '0190b0a0-0000-7000-8000-000000000a22',
    role: 'ADMIN',
    channel: 'EMAIL',
    contactMasked: 'f•••@yahoo.com',
    status: 'EXPIRED',
    invitedAt: '2026-11-02T08:30:00.000Z',
    expiresAt: '2026-11-09T08:30:00.000Z',
  },
];

const MEMBER_IDS: Record<CourierPersonaId, string> = {
  'courier-admin': '0190b0a0-0000-7000-8000-000000000a11',
  'courier-operator': '0190b0a0-0000-7000-8000-000000000a12',
};

export const isCourier = (persona: PersonaId): persona is CourierPersonaId => persona in MEMBER_IDS;

export function logisticsMeFor(persona: CourierPersonaId): LogisticsMe {
  return {
    company: COMPANY,
    member: { id: MEMBER_IDS[persona], role: persona === 'courier-admin' ? 'ADMIN' : 'OPERATOR' },
  };
}

const paged = <T>(items: readonly T[]) => ({ items: [...items], page: 1, limit: 100, total: items.length });

export const logisticsMembersFor = () => paged(MEMBERS);
export const logisticsInvitationsFor = () => paged(INVITATIONS);

type Check = (
  failures: string[],
  label: string,
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { message: string } } },
  value: unknown,
) => void;

/** The portal's reads, against the contracts logistics-ops parses. */
export function checkLogisticsFixtures(failures: string[], check: Check): void {
  for (const persona of Object.keys(MEMBER_IDS) as CourierPersonaId[]) {
    check(failures, `logistics me for ${persona}`, getLogisticsMe.schema.response, logisticsMeFor(persona));
  }
  check(failures, 'logistics members', listLogisticsMembers.schema.response, logisticsMembersFor());
  check(
    failures,
    'logistics invitations',
    listLogisticsInvitations.schema.response,
    logisticsInvitationsFor(),
  );
}
