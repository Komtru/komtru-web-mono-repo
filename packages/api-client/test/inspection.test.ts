import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import { getFile } from '../src/files.js';
import {
  acceptDeliveryExtension,
  confirmDelivery,
  declineDeliveryExtension,
  requestDeliveryExtension,
} from '../src/fulfilment.js';
import {
  acceptInspection,
  acceptInspectionExtension,
  declineInspectionExtension,
  getInspection,
  requestInspectionExtension,
} from '../src/trades.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const recording = (body: unknown) => {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(json(body));
  });
  return { calls, client: createApiClient({ baseUrl: 'https://api.test/v1', fetch }) };
};

describe('the delivery, inspection and release endpoints (T-064, T-065)', () => {
  it('mirror the routes: consumer scope, every write keyed for retries', () => {
    const writes = [
      [confirmDelivery, '/trades/:id/confirm-delivery'],
      [acceptInspection, '/trades/:id/accept-inspection'],
      [requestInspectionExtension, '/trades/:id/inspection-extension'],
      [acceptInspectionExtension, '/trades/:id/inspection-extension/:requestId/accept'],
      [declineInspectionExtension, '/trades/:id/inspection-extension/:requestId/decline'],
      [requestDeliveryExtension, '/trades/:id/delivery-extension'],
      [acceptDeliveryExtension, '/trades/:id/delivery-extension/:requestId/accept'],
      [declineDeliveryExtension, '/trades/:id/delivery-extension/:requestId/decline'],
    ] as const;
    for (const [endpoint, path] of writes) {
      expect(endpoint).toMatchObject({ method: 'post', path, scope: 'CONSUMER', retryable: true });
    }
    expect(getFile).toMatchObject({ method: 'get', path: '/files/:id', scope: 'CONSUMER' });
  });

  it('releases only with the explicit acknowledgement in the body', () => {
    const body = acceptInspection.schema.body;
    expect(body.safeParse({ acknowledged: true }).success).toBe(true);
    expect(body.safeParse({ acknowledged: false }).success).toBe(false);
    expect(body.safeParse({}).success).toBe(false);
  });

  it('reads Z4 with the proof, the delivery evidence and the sentence being acknowledged', async () => {
    const { client } = recording({
      status: 'INSPECTION',
      yourRole: 'BUYER',
      window: { hours: 48, startedAt: null, deadlineAt: null, extended: false, autoReleasePaused: false },
      extensionRequest: null,
      canRequestMoreTime: true,
      canRespondToRequest: false,
      sellerProof: { media: [{ fileId: id(7), attachedAt: '2026-11-09T09:00:00.000Z' }] },
      deliveryEvidence: {
        signals: [{ source: 'SELLER_SELF_REPORT', reportedAt: '2026-11-10T09:00:00.000Z' }],
        selfArranged: {
          waybillNumber: 'W1',
          shippedAt: '2026-11-09T10:00:00.000Z',
          vehiclePlate: 'LSR123AB',
        },
      },
      release: { acknowledgement: 'RELEASE_IS_FINAL_V1', acknowledgedAt: null },
    });
    const view = await client.call(getInspection, { params: { id: id(1) } });
    expect(view.sellerProof?.media[0]?.fileId).toBe(id(7));
    expect(view.deliveryEvidence.selfArranged?.vehiclePlate).toBe('LSR123AB');
  });

  it('sends the delivery extension as an instant and an enum reason', async () => {
    const { calls, client } = recording({ id: id(2), status: 'PENDING' });
    await client.call(requestDeliveryExtension, {
      params: { id: id(1) },
      body: { reason: 'RESTOCKING_ITEM', requestedDueAt: '2026-11-15T18:00:00.000Z' },
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `https://api.test/v1/trades/${id(1)}/delivery-extension`,
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      reason: 'RESTOCKING_ITEM',
      requestedDueAt: '2026-11-15T18:00:00.000Z',
    });
  });
});
