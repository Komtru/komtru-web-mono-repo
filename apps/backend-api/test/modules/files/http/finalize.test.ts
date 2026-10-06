// The finalize controller's enqueue, which has one job to do that is easy to get wrong.
//
// BullMQ keeps a FAILED job for 30 days (platform/queue/factory.ts's removeOnFail), and `add` with
// an existing jobId is a silent no-op that returns the job already there. So reusing the file id as
// the job id — which is right, because it is what stops a double-submit queueing two
// reconciliations — means that once the finalize job exhausts its attempts, every later
// POST /files/:id/finalize answers 202 and does nothing at all, until the abandoned sweep tombstones
// a file that did land. Clearing the spent job first is what makes the retry real.
import { describe, expect, it, vi } from 'vitest';
import type { FilesConfig } from '../../../../src/config/env.js';
import type { Db } from '../../../../src/db/index.js';
import { createLogger } from '../../../../src/platform/logger.js';
import type { QueueFactory } from '../../../../src/platform/queue/factory.js';
import { finalizeUpload } from '../../../../src/modules/files/http/controllers.js';
import type { FileRecord } from '../../../../src/modules/files/infrastructure/postgres/schema/index.js';
import * as fileService from '../../../../src/modules/files/services/file.service.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const files: FilesConfig = {
  accounts: {},
  maxUploadBytes: 1024,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
};

const FILE_ID = '11111111-1111-4111-8111-111111111111';

const record = (uploadState: FileRecord['uploadState']): FileRecord =>
  ({ id: FILE_ID, uploadState }) as FileRecord;

const harness = () => {
  const calls: string[] = [];
  const remove = vi.fn(() => {
    calls.push('remove');
    return Promise.resolve(1);
  });
  const add = vi.fn(() => {
    calls.push('add');
    return Promise.resolve({ id: FILE_ID });
  });
  const queues = { producer: () => ({ remove, add }) } as unknown as QueueFactory;
  return {
    calls,
    remove,
    add,
    deps: {
      db: () => ({}) as Db,
      queues: () => queues,
      config: () => files,
      logger: () => logger,
    },
  };
};

describe('finalizeUpload', () => {
  it('clears any spent job before enqueuing, so a dead-lettered finalize can be retried', async () => {
    const { deps, remove, add, calls } = harness();
    vi.spyOn(fileService, 'requestFinalize').mockResolvedValue(record('RECONCILING'));

    await finalizeUpload(deps, { uploaderUserId: 'u', fileId: FILE_ID });

    expect(remove).toHaveBeenCalledWith(FILE_ID);
    expect(add).toHaveBeenCalledWith(
      'finalize',
      { fileId: FILE_ID },
      expect.objectContaining({ jobId: FILE_ID }),
    );
    // Order matters: adding first would hit the existing job and the remove would then delete the
    // one we just queued.
    expect(calls).toEqual(['remove', 'add']);
    vi.restoreAllMocks();
  });

  it('still enqueues when there was no job to clear', async () => {
    // `remove` on an absent job resolves 0 in BullMQ; it must not stop the enqueue.
    const { deps, add } = harness();
    vi.spyOn(fileService, 'requestFinalize').mockResolvedValue(record('RECONCILING'));

    await finalizeUpload(deps, { uploaderUserId: 'u', fileId: FILE_ID });

    expect(add).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('enqueues nothing for a file that is already READY', async () => {
    const { deps, add, remove } = harness();
    vi.spyOn(fileService, 'requestFinalize').mockResolvedValue(record('READY'));

    const result = await finalizeUpload(deps, { uploaderUserId: 'u', fileId: FILE_ID });

    expect(result).toEqual({ fileId: FILE_ID, uploadState: 'READY' });
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('propagates an enqueue failure instead of answering 202 with nothing queued', async () => {
    // The catch must cover the REMOVE only. `guardEnqueue` throws QueueUnavailableError when Redis
    // is not reachable, precisely so an enqueue during an outage fails instead of hanging — and
    // swallowing it here hands the caller a 202 for work that will never run, which is the very
    // failure this whole code path was written to close: nothing reconciles, and the abandoned
    // sweep later tombstones a file that did land.
    const { deps } = harness();
    const queues = {
      producer: () => ({
        remove: () => Promise.resolve(1),
        add: () => Promise.reject(new Error('queue is unavailable: Redis is not reachable')),
      }),
    } as unknown as QueueFactory;
    vi.spyOn(fileService, 'requestFinalize').mockResolvedValue(record('RECONCILING'));

    await expect(
      finalizeUpload({ ...deps, queues: () => queues }, { uploaderUserId: 'u', fileId: FILE_ID }),
    ).rejects.toThrow(/Redis is not reachable/);
    vi.restoreAllMocks();
  });

  it('does not fail the request when clearing the spent job fails', async () => {
    // A locked job (one actively being worked) cannot be removed. That is the benign case — the
    // reconciliation the caller is asking for is already running — so the enqueue is skipped and
    // the 202 stands.
    const { deps } = harness();
    const queues = {
      producer: () => ({
        remove: () => Promise.reject(new Error('job is locked')),
        add: () => Promise.resolve({ id: FILE_ID }),
      }),
    } as unknown as QueueFactory;
    vi.spyOn(fileService, 'requestFinalize').mockResolvedValue(record('RECONCILING'));

    await expect(
      finalizeUpload({ ...deps, queues: () => queues }, { uploaderUserId: 'u', fileId: FILE_ID }),
    ).resolves.toMatchObject({ uploadState: 'RECONCILING' });
    vi.restoreAllMocks();
  });
});
