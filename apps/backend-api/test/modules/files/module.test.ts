// What the files module declares to the platform, and what its barrel does and does not let out.
import { describe, expect, it } from 'vitest';
import * as barrel from '../../../src/modules/files/index.js';
import { FILES_QUEUES, FILES_SCHEDULES } from '../../../src/modules/files/domain/queues.js';
import { moduleSeeds } from '../../../src/modules/index.js';
import { assertRouteInvariants } from '../../../src/platform/http/route.js';
import { createScheduleRegistry } from '../../../src/platform/scheduler/registry.js';
import { testModule, testModules } from '../../support/modules.js';

const filesModule = () => testModule('files');

describe('the files module in the registry', () => {
  it('is registered', () => {
    expect(testModules().map((module) => module.name)).toContain('files');
  });

  it('starts after identity and before notify', () => {
    // identity owns the actor resolver every scoped route is checked against; notify stays last
    // because it only subscribes to what the others publish.
    const names = testModules().map((module) => module.name);
    expect(names.indexOf('files')).toBeGreaterThan(names.indexOf('identity'));
    expect(names.indexOf('files')).toBeLessThan(names.indexOf('notify'));
  });

  it('contributes a seed that db:migrate can run with only a database', () => {
    const seed = moduleSeeds.find((module) => module.name === 'files');
    expect(seed?.seed).toBeTypeOf('function');
  });

  it('declares the finalize and destroy queues', () => {
    expect(filesModule().queues?.map((queue) => queue.name)).toEqual([
      FILES_QUEUES.FINALIZE,
      FILES_QUEUES.DESTROY,
    ]);
  });

  it('gives finalize a retry budget that matches the wait its job promises', () => {
    // runFinalizeUpload throws while Cloudinary cannot see the asset, on the stated reasoning that
    // the client may still be uploading a large photo over a slow mobile connection. The queue
    // defaults — 5 attempts from 2s exponential — are about thirty SECONDS, which is nowhere near
    // that, and exhausting them dead-letters a file that did land. 8 attempts from 15s is ~32
    // minutes of real waiting, just over the upload-ticket TTL that bounds the whole exchange.
    const finalize = filesModule().queues?.find((queue) => queue.name === FILES_QUEUES.FINALIZE);
    expect(finalize?.attempts).toBe(8);
    expect(finalize?.backoffMs).toBe(15_000);
  });

  it('declares the usage sweep and the abandoned-ticket sweep, with cron the registry accepts', () => {
    const schedules = filesModule().schedules ?? [];
    expect(schedules.map((schedule) => schedule.name)).toEqual([
      FILES_SCHEDULES.SYNC_USAGE,
      FILES_SCHEDULES.PURGE_ABANDONED,
    ]);
    const registry = createScheduleRegistry();
    for (const schedule of schedules) expect(() => registry.register(schedule)).not.toThrow();
  });

  it('declares the M20 §9 routes and passes the platform invariants', () => {
    const routes = filesModule().routes ?? [];
    expect(routes).toHaveLength(11);
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('answers a job that runs before start() with an error naming the module', async () => {
    // The platform reads `queues` off a module before start, so a handler that closed over the
    // context would see undefined. This throw is what makes that a loud failure rather than a crash
    // deep inside drizzle.
    const queue = filesModule().queues?.[0];
    await expect((queue?.process as (data: unknown) => Promise<unknown>)({ fileId: 'x' })).rejects.toThrow(
      /files module/,
    );
  });

  it('answers a schedule that runs before start() the same way', async () => {
    const schedule = filesModule().schedules?.[0];
    await expect(schedule?.handler(new Date())).rejects.toThrow(/files module/);
  });
});

describe('the files barrel', () => {
  it('exports the schema other modules read', () => {
    for (const name of ['fileRecords', 'fileAccessGrants', 'fileAccessLog', 'storageAccounts']) {
      expect(barrel).toHaveProperty(name);
    }
  });

  it('exports the five events', () => {
    for (const name of [
      'fileUploaded',
      'fileAccessGranted',
      'fileTombstoned',
      'storageAccountNearQuota',
      'storageAccountDisabled',
    ]) {
      expect(barrel).toHaveProperty(name);
    }
  });

  it('exports the upload and retrieval API every consuming module uses (D1)', () => {
    for (const name of [
      'createUploadTicket',
      'requestTombstone',
      'tombstoneByUploader',
      'findFile',
      'findServableFile',
      'retrieveFile',
      'subjectFrom',
      'grantAccess',
      'revokeGrant',
      'listGrants',
    ]) {
      expect(barrel).toHaveProperty(name);
    }
  });

  it('exports the domain tables a consumer needs to pick a visibility', () => {
    for (const name of [
      'POOL_BY_CATEGORY',
      'ALLOWED_VISIBILITY',
      'ALLOWED_CONTENT_TYPES',
      'AUDITED_CATEGORIES',
    ]) {
      expect(barrel).toHaveProperty(name);
    }
  });

  it('does not export a way to sign a URL without an access decision', () => {
    // There is exactly one path from a file id to bytes, and it runs decideAccess and writes the
    // audit row on the way. A convenience signUrl(fileId) would be the second path, and the second
    // path is the one that is wrong after somebody changes the policy.
    for (const name of ['buildSignedDeliveryUrl', 'buildExpiringDownloadUrl', 'buildSignedUpload']) {
      expect(barrel).not.toHaveProperty(name);
    }
  });

  it('does not export credential resolution or the provider client', () => {
    // api_secret never leaves cloudinary.signing.ts's and cloudinary.client.ts's call stacks.
    for (const name of [
      'credentialsFor',
      'isAccountConfigured',
      'createCloudinaryClient',
      'storageProvider',
    ]) {
      expect(barrel).not.toHaveProperty(name);
    }
  });

  it('does not export storage-account registration or rotation', () => {
    // D1: a consumer passes a category and never learns which of the five accounts holds the bytes.
    for (const name of ['selectAccountForPool', 'registerAccount', 'nextInRotation']) {
      expect(barrel).not.toHaveProperty(name);
    }
  });
});
