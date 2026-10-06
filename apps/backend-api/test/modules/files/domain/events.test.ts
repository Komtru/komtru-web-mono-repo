// M20 §7. Two of the five are ops alerting rather than domain events, and they are the ones that
// matter operationally: a TRADE_ASSET account crossing its quota threshold is the signal that
// somebody must provision a sixth account before uploads start failing closed (D6).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FILE_EVENTS,
  fileAccessGranted,
  fileTombstoned,
  fileUploaded,
  storageAccountDisabled,
  storageAccountNearQuota,
} from '../../../../src/modules/files/domain/events.js';

describe('files events', () => {
  it('publishes the five M20 §7 events under the module’s own namespace', () => {
    expect(FILE_EVENTS.map((event) => event.eventType)).toEqual([
      'files.file.uploaded',
      'files.file.access_granted',
      'files.file.tombstoned',
      'files.storage_account.near_quota',
      'files.storage_account.disabled',
    ]);
  });

  it('versions every event at 1', () => {
    for (const event of FILE_EVENTS) expect(event.version).toBe(1);
  });

  it('rejects an upload payload with no file id, at the publisher', () => {
    // Parsed by `publish` inside the caller's transaction, so a bad payload fails the write that
    // caused it rather than every subscriber's job five minutes later.
    expect(() => fileUploaded.payload.parse({ category: 'KYC_DOCUMENT' })).toThrow();
  });

  it('accepts a complete upload payload', () => {
    expect(
      fileUploaded.payload.parse({
        fileId: randomUUID(),
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        uploaderUserId: randomUUID(),
        owningModule: 'park',
        sizeBytes: 4096,
      }),
    ).toMatchObject({ category: 'CUSTODY_EVIDENCE' });
  });

  it('lets a grant name a user or a role, and requires the field to be stated either way', () => {
    const base = { fileId: randomUUID(), reason: 'dispute opened' };
    expect(
      fileAccessGranted.payload.parse({ ...base, granteeUserId: randomUUID(), granteeRole: null }),
    ).toBeTruthy();
    expect(
      fileAccessGranted.payload.parse({ ...base, granteeUserId: null, granteeRole: 'DISPUTE_REVIEWER' }),
    ).toBeTruthy();
    expect(() => fileAccessGranted.payload.parse(base)).toThrow();
  });

  it('allows a tombstone with no human actor, for an M15 retention sweep', () => {
    expect(
      fileTombstoned.payload.parse({
        fileId: randomUUID(),
        category: 'KYC_DOCUMENT',
        reason: 'retention policy',
        actorUserId: null,
      }),
    ).toMatchObject({ actorUserId: null });
  });

  it('carries enough in a quota alert for ops to act without a second lookup', () => {
    const payload = {
      accountId: randomUUID(),
      label: 'trade-2',
      pool: 'TRADE_ASSET' as const,
      creditsUsedPct: 91.5,
    };
    expect(storageAccountNearQuota.payload.parse(payload)).toMatchObject({ label: 'trade-2' });
    expect(storageAccountDisabled.payload.parse({ ...payload, reason: 'QUOTA_EXCEEDED' })).toMatchObject({
      reason: 'QUOTA_EXCEEDED',
    });
  });
});
