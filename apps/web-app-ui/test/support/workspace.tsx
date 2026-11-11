// What the workspace suites share beyond `support/trade`: a trade past the agreement, the platform's other reads
// of it (deadline, inspection, activity), and a socket that behaves as socket.io-client does.
import type { ApiClient } from '@komtru/api-client';
import { ApiClientProvider, RealtimeProvider } from '@komtru/api-client/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import { id, tradeView, type CallFn } from './trade';

export * from './trade';

export const FEES = {
  scheduleVersion: '2026-10-05.1',
  itemAmountMinor: '45200000',
  buyerProtectionFeeMinor: '678000',
  buyerTotalMinor: '45878000',
  commissionMinor: '0',
  sellerProceedsMinor: '45200000',
};

/** A trade past the agreement, seen from `role`. */
export const workspaceTrade = (
  status: string,
  role: 'BUYER' | 'SELLER' = 'BUYER',
  over: Record<string, unknown> = {},
) =>
  tradeView({
    status,
    yourRole: role,
    initiatorRole: 'BUYER',
    awaiting: null,
    statusRevision: 9,
    fees: FEES,
    acceptedAt: '2026-09-30T08:41:00.000Z',
    terms: {
      ...tradeView().terms,
      versionNumber: 2,
      shipsFromAddress: { street: '14 Marina Road', landmark: 'Lagos Island' },
    },
    ...over,
  });

export const deliveryDeadline = (dueAt = '2026-11-12T09:00:00.000Z') => ({
  deadline: { id: id(90), status: 'PENDING', dueAt, originalDueAt: dueAt, extensionCount: 0 },
  extensionRequest: null,
});

export const inspectionRead = (over: Record<string, unknown> = {}) => ({
  tradeId: id(1),
  tradeCode: 'KMT-9042800-NG',
  status: 'INSPECTION',
  yourRole: 'BUYER',
  window: {
    hours: 48,
    startedAt: '2026-09-30T12:24:00.000Z',
    deadlineAt: '2026-10-02T12:24:00.000Z',
    extended: false,
    autoReleasePaused: false,
  },
  extensionRequest: null,
  canRequestMoreTime: true,
  canRespondToRequest: false,
  sellerProof: {
    media: [
      { fileId: id(7), attachedAt: '2026-09-29T09:00:00.000Z' },
      { fileId: id(8), attachedAt: '2026-09-29T09:01:00.000Z' },
    ],
  },
  deliveryEvidence: {
    signals: [{ source: 'SELLER_SELF_REPORT', reportedAt: '2026-09-30T12:20:00.000Z' }],
    selfArranged: {
      waybillNumber: 'KT-883192',
      shippedAt: '2026-09-30T12:18:00.000Z',
      vehiclePlate: 'LSR123AB',
    },
  },
  release: { acknowledgement: 'RELEASE_IS_FINAL_V1', acknowledgedAt: null },
  ...over,
});

export const activityRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: `S:${String(n)}`,
  occurredAt: '2026-09-30T12:24:00.000000Z',
  kind: 'FUNDS_PROTECTED',
  actor: 'KOMTRU',
  toStatus: 'FUNDED',
  reason: null,
  ...over,
});

type Handler = (...args: never[]) => void;

/** A socket that fires `connect` on demand, answers `room:join`, and records what it was asked. */
export function fakeSocket() {
  const handlers = new Map<string, Set<Handler>>();
  const manager = new Map<string, Set<Handler>>();
  const bind = (map: Map<string, Set<Handler>>) => ({
    on: (event: string, handler: Handler) => {
      const set = map.get(event) ?? new Set<Handler>();
      set.add(handler);
      map.set(event, set);
    },
    off: (event: string, handler: Handler) => {
      map.get(event)?.delete(handler);
    },
  });
  const emitWithAck = vi.fn((_event: string, _payload?: unknown) =>
    Promise.resolve<unknown>({ joined: true }),
  );
  const socket = {
    ...bind(handlers),
    disconnect: vi.fn(),
    emit: vi.fn(),
    emitWithAck,
    io: bind(manager),
  };
  return {
    socket,
    emitWithAck,
    fire: (event: string, ...args: unknown[]) => {
      for (const handler of [...(handlers.get(event) ?? [])]) (handler as (...a: unknown[]) => void)(...args);
    },
    listening: (event: string) => (handlers.get(event)?.size ?? 0) > 0,
    listeners: (event: string) => handlers.get(event)?.size ?? 0,
    joins: () =>
      emitWithAck.mock.calls.filter(([event]) => event === 'room:join').map(([, payload]) => payload),
  };
}
export type FakeSocket = ReturnType<typeof fakeSocket>;

/** The screen inside the real realtime provider, so a push and a reconnect reach it the way they do in the app. */
export const renderLive = (call: Mock<CallFn>, fake: FakeSocket, ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApiClientProvider client={{ call } as unknown as ApiClient}>
        <RealtimeProvider token="at" url="http://socket.test" connect={() => fake.socket as never}>
          {ui}
        </RealtimeProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );

/** What `GET /files/:id` answers for a seller's proof photo. */
export const fileRead = (n: number, contentType = 'image/jpeg') => ({
  fileId: id(n),
  url: `https://files.test/${String(n)}.jpg?sig=1`,
  expiresAt: '2026-11-11T12:30:00.000Z',
  contentType,
});
