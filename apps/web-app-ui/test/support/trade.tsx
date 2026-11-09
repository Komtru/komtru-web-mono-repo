// What the trade screens' suites share. Same shape as `apps/operations-app/test/support/cases.tsx`: the
// client is a mocked `call`, an endpoint with no handler rejects loudly, and the screen is rendered
// inside the real query client so caching and invalidation behave as they do in the app.
import type { ApiClient, TradeView } from '@komtru/api-client';
import { ApiClientProvider } from '@komtru/api-client/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Mock } from 'vitest';

export interface CallEndpoint {
  method: string;
  path: string;
}
export interface CallInput {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}
export type CallFn = (endpoint: CallEndpoint, input?: CallInput) => Promise<unknown>;

export const id = (n: number): string => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

type Handler = (input: CallInput) => unknown;

/** Makes a mocked `client.call` answer by "METHOD /path". A handler may be a value, a function or a thrown error. */
export function answerWith(call: Mock<CallFn>, handlers: Record<string, unknown>): void {
  call.mockImplementation((endpoint, input = {}) => {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    if (!(key in handlers)) return Promise.reject(new Error(`no handler for ${key}`));
    const handler = handlers[key];
    try {
      const value = typeof handler === 'function' ? (handler as Handler)(input) : handler;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export const renderWithApi = (call: Mock<CallFn>, ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApiClientProvider client={{ call } as unknown as ApiClient}>{ui}</ApiClientProvider>
    </QueryClientProvider>,
  );

/** Every call the screen made to one endpoint, in order. */
export const callsTo = (call: Mock<CallFn>, method: string, path: string): CallInput[] =>
  call.mock.calls
    .filter(([endpoint]) => endpoint.method.toUpperCase() === method && endpoint.path === path)
    .map(([, input]) => input ?? {});

export const page = <T,>(items: T[]) => ({ items, nextCursor: null });

export const address = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  label: n === 1 ? 'Home' : `Address ${String(n)}`,
  recipientName: 'Ada Obi',
  recipientPhone: '+2348012345678',
  streetLine: '12 Allen Avenue',
  landmark: null,
  stateId: id(70),
  stateName: 'Lagos',
  cityId: id(71),
  cityName: 'Ikeja',
  cityActive: true,
  isDefault: n === 1,
  archivedAt: null,
  createdAt: '2026-11-06T10:00:00.000Z',
  updatedAt: '2026-11-06T10:00:00.000Z',
  ...over,
});

export const electronics = {
  versionId: id(60),
  categoryCode: 'electronics',
  categoryName: 'Electronics',
  versionNumber: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  inspectionWindowHours: 48,
  itemSpecFields: [
    { key: 'brand', label: 'Brand', required: true },
    { key: 'model', label: 'Model', required: true },
    { key: 'condition', label: 'Condition', required: true },
    { key: 'serial', label: 'Serial number', required: false },
  ],
  proofMedia: { minPhotos: 2, requireVideo: false },
  imeiVerification: false,
  deliveryDeadlineDays: 7,
};

export const fashion = {
  ...electronics,
  versionId: id(61),
  categoryCode: 'fashion',
  categoryName: 'Fashion & Luxury',
  inspectionWindowHours: 24,
  itemSpecFields: [{ key: 'brand', label: 'Brand', required: true }],
  proofMedia: { minPhotos: 0, requireVideo: false },
};

export const standardsPage = (items = [electronics, fashion]) => ({
  items,
  page: 1,
  limit: 100,
  total: items.length,
});

export const preview = (allowedRoles: string[] = ['BUYER', 'SELLER']) => ({
  allowedRoles,
  standard: {
    categoryCode: 'electronics',
    versionNumber: 1,
    inspectionWindowHours: 48,
    itemSpecFields: electronics.itemSpecFields,
    proofMedia: electronics.proofMedia,
    deliveryDeadlineDays: 7,
  },
  fees: [
    {
      sellerKind: 'CASUAL',
      snapshot: {
        amounts: {
          itemMinor: '45200000',
          buyerProtectionFeeMinor: '678000',
          buyerTotalMinor: '45878000',
          sellerProceedsMinor: '45200000',
        },
      },
    },
  ],
});

export const party = (over: Record<string, unknown> = {}) => ({
  found: true,
  party: {
    publicId: 'U-TECH',
    username: 'techedge',
    displayName: 'TechEdge NG',
    avatarUrl: null,
    verificationLevel: 'LEVEL_2',
    badges: [],
    memberSince: '2025-01-01',
    completedTrades: 342,
    isMerchant: false,
    merchantName: null,
    canBuy: true,
    ...over,
  },
});

export const miss = (canInvite = true) => ({ found: false, canInvite, maskedHint: null });

export const tradeView = (over: Record<string, unknown> = {}): TradeView => ({
  id: id(1),
  tradeCode: 'KMT-90428',
  status: 'AWAITING_ACCEPTANCE',
  statusRevision: 2,
  initiatorRole: 'BUYER',
  yourRole: 'SELLER',
  awaiting: 'YOU',
  terms: {
    versionId: id(40),
    versionNumber: 1,
    proposedByRole: 'BUYER',
    itemAmountMinor: '45200000',
    currency: 'NGN',
    itemSpec: { brand: 'Apple', model: 'iPhone 13 Pro', condition: 'Sealed box' },
    inspectionWindowHours: 48,
    deliveryGraceHours: 24,
    deliveryAddress: { street: '5 Adeola Odeku', landmark: 'Victoria Island', recipient: 'Amaka B.' },
    shipsFromAddress: null,
    createdAt: '2026-11-09T09:00:00.000Z',
  },
  fees: null,
  proofMediaCount: 0,
  sentAt: '2026-11-09T09:05:00.000Z',
  acceptedAt: null,
  createdAt: '2026-11-09T09:00:00.000Z',
  ...over,
});

/** Every screen ends in the same accessibility check; `heading-order` is the shell's, as in operations-app. */
export const SHELL_RULES = ['heading-order'];
