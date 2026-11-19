// The webhook path end to end against a real database: signature, delivery log, lifecycle, and the
// liveness request it resolves. Skipped unless KOMTRU_INFRA_TESTS=1.
//
// The cases that matter are the ones where the delivery is NOT the happy path, because every one of
// them is reachable from the public internet: a replay, an expired request, a reference that names
// nothing, a reference that names somebody else's check, and a body nobody signed.
import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import {
  claimDelivery,
  finishDelivery,
  findDelivery,
  findRequestBySessionRef,
  reapStaleDeliveries,
  recordDelivery,
} from '../../../src/modules/trust/infrastructure/postgres/webhooks.js';
import { verificationRequests } from '../../../src/modules/trust/infrastructure/postgres/schema/requests.js';
import { verifyYouverifySignature } from '../../../src/modules/trust/infrastructure/providers/youverify.signature.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

const SECRET = 'webhook-secret';
const sign = (raw: Buffer): string => createHmac('sha256', SECRET).update(raw).digest('hex');

const delivery = (eventId: string, sessionRef: string): Buffer =>
  Buffer.from(
    JSON.stringify({
      event: 'identity.verification.completed',
      apiVersion: 'v2',
      data: { id: eventId, status: 'completed', passed: true, metadata: { reference: sessionRef } },
    }),
  );

describe.runIf(infraEnabled)('youverify webhook delivery log', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());

  const seedRequest = async (
    sessionRef: string,
    status: 'PROVIDER_PENDING' | 'EXPIRED' = 'PROVIDER_PENDING',
  ): Promise<string> => {
    const id = randomUUID();
    await db()
      .insert(verificationRequests)
      .values({
        id,
        userId: randomUUID(),
        verificationType: 'LIVENESS',
        status,
        targetLevel: 2,
        providerSessionRef: sessionRef,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    return id;
  };

  const store = async (eventId: string, sessionRef: string, valid = true) => {
    const raw = delivery(eventId, sessionRef);
    const signature = valid ? sign(raw) : 'deadbeef';
    const signatureValid = verifyYouverifySignature(raw, signature, SECRET);
    return recordDelivery(db(), {
      provider: 'YOUVERIFY',
      providerEventId: eventId,
      eventType: 'identity.verification.completed',
      payload: JSON.parse(raw.toString()),
      rawBodySha256: createHmac('sha256', 'x').update(raw).digest('hex'),
      signatureValid,
    });
  };

  it('stores a signed delivery at RECEIVED, ready to be claimed', async () => {
    const result = await store(`evt-${randomUUID()}`, `ref-${randomUUID()}`);
    expect(result.outcome).toBe('stored');
    const row = await findDelivery(db(), result.id);
    expect(row?.status).toBe('RECEIVED');
    expect(row?.signatureValid).toBe(true);
    expect(row?.attempts).toBe(0);
  });

  it('absorbs a replay into a counter rather than a second row', async () => {
    const eventId = `evt-${randomUUID()}`;
    const ref = `ref-${randomUUID()}`;
    const first = await store(eventId, ref);
    const second = await store(eventId, ref);
    expect(second.outcome).toBe('duplicate');
    expect(second.id).toBe(first.id);
    expect((await findDelivery(db(), first.id))?.duplicateCount).toBe(1);
  });

  it('stores an unsigned delivery at SKIPPED so a rotated key is visible, never at RECEIVED', async () => {
    const result = await store(`evt-${randomUUID()}`, `ref-${randomUUID()}`, false);
    expect(result.outcome).toBe('unsigned');
    const row = await findDelivery(db(), result.id);
    expect(row?.status).toBe('SKIPPED');
    expect(row?.signatureValid).toBe(false);
    expect(row?.finishedAt).not.toBeNull();
  });

  it('refuses to claim an unsigned delivery, so it can never be processed', async () => {
    const result = await store(`evt-${randomUUID()}`, `ref-${randomUUID()}`, false);
    expect(await claimDelivery(db(), result.id)).toBe(false);
  });

  it('lets exactly one worker claim a delivery', async () => {
    const result = await store(`evt-${randomUUID()}`, `ref-${randomUUID()}`);
    expect(await claimDelivery(db(), result.id)).toBe(true);
    expect(await claimDelivery(db(), result.id)).toBe(false);
    const row = await findDelivery(db(), result.id);
    expect(row?.status).toBe('PROCESSING');
    expect(row?.processingStartedAt).not.toBeNull();
    expect(row?.attempts).toBe(1);
  });

  it('records a finish only from the worker holding it', async () => {
    const result = await store(`evt-${randomUUID()}`, `ref-${randomUUID()}`);
    await claimDelivery(db(), result.id);
    expect(await finishDelivery(db(), result.id, 'PROCESSED')).toBe(true);
    expect(await finishDelivery(db(), result.id, 'FAILED', 'late')).toBe(false);
    const row = await findDelivery(db(), result.id);
    expect(row?.status).toBe('PROCESSED');
    expect(row?.finishedAt).not.toBeNull();
  });

  it('returns a delivery whose worker died, bounded by attempts', async () => {
    const result = await store(`evt-${randomUUID()}`, `ref-${randomUUID()}`);
    await claimDelivery(db(), result.id);
    const reaped = await reapStaleDeliveries(db(), -1, 10);
    // Ids, not a count: the caller has to re-queue them, because marking a row claimable is not
    // the same as arranging for a claim. Returning a number made that impossible to do.
    expect(reaped).toContain(result.id);
    const row = await findDelivery(db(), result.id);
    expect(row?.status).toBe('FAILED');
    expect(row?.processingError).toMatch(/worker presumed lost/i);
    // Reclaimable, which is the point of FAILED rather than a terminal state.
    expect(await claimDelivery(db(), result.id)).toBe(true);
  });

  it('stops reaping once attempts are exhausted, so a poisonous delivery becomes visible', async () => {
    const result = await store(`evt-${randomUUID()}`, `ref-${randomUUID()}`);
    await claimDelivery(db(), result.id);
    expect(await reapStaleDeliveries(db(), -1, 1)).toEqual([]);
    expect((await findDelivery(db(), result.id))?.status).toBe('PROCESSING');
  });

  it('finds the request a reference names, and nothing for one it does not', async () => {
    const ref = `ref-${randomUUID()}`;
    const requestId = await seedRequest(ref);
    expect((await findRequestBySessionRef(db(), ref))?.id).toBe(requestId);
    expect(await findRequestBySessionRef(db(), `ref-${randomUUID()}`)).toBeUndefined();
  });

  it('will not let two requests share one session reference', async () => {
    const ref = `ref-${randomUUID()}`;
    await seedRequest(ref);
    await expect(seedRequest(ref)).rejects.toThrow();
  });

  it('finds an expired request so the job can refuse it rather than silently resurrect it', async () => {
    const ref = `ref-${randomUUID()}`;
    await seedRequest(ref, 'EXPIRED');
    expect((await findRequestBySessionRef(db(), ref))?.status).toBe('EXPIRED');
  });
});
