// The only file in the files module that reaches the network (design §4.4, T-028). Tested against a
// real local HTTP server rather than a mocked fetch, so timeouts, retries and the form encoding of
// the destroy call are exercised the way providerRequest actually runs them.
//
// HONEST CAVEAT: no call here has ever been made against a live Cloudinary account from this
// repository. Request and response shapes follow Cloudinary's published Admin API documentation.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { FilesConfig } from '../../../../src/config/env.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { StorageAccountUnconfiguredError } from '../../../../src/modules/files/domain/errors.js';
import {
  createCloudinaryClient,
  type CloudinaryClient,
} from '../../../../src/modules/files/infrastructure/providers/cloudinary.client.js';
import { startStubServer, type StubServer } from '../../../support/stub-server.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const PREFIX = 'CLOUDINARY_TRADE_1';

const config = (): FilesConfig => ({
  accounts: { [PREFIX]: { cloudName: 'demo', apiKey: '1234', apiSecret: 'not-a-real-secret' } },
  maxUploadBytes: 1024,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
});

let stub: StubServer | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const clientAgainst = async (
  handler: (req: IncomingMessage, res: ServerResponse, hit: number) => void,
  files: FilesConfig = config(),
): Promise<CloudinaryClient> => {
  stub = await startStubServer(handler);
  return createCloudinaryClient({
    files,
    logger,
    baseUrl: stub.url,
    timeoutMs: 1_000,
    maxAttempts: 1,
    backoffMs: 1,
  });
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('fetchUsage', () => {
  it('prefers the provider’s own used_percent', async () => {
    const client = await clientAgainst((_req, res) =>
      json(res, 200, { storage: { usage: 17_000 }, credits: { usage: 4, limit: 25, used_percent: 16 } }),
    );
    await expect(client.fetchUsage(PREFIX)).resolves.toEqual({
      storageUsedBytes: 17_000,
      creditsUsedPct: 16,
    });
  });

  it('derives used_percent when the provider omits it', async () => {
    // The field has moved between API versions, and an absent one must not silently read as zero:
    // an account reporting 0% forever is an account that never trips a threshold and fills up in
    // silence.
    const client = await clientAgainst((_req, res) =>
      json(res, 200, { storage: { usage: 1 }, credits: { usage: 5, limit: 25 } }),
    );
    await expect(client.fetchUsage(PREFIX)).resolves.toMatchObject({ creditsUsedPct: 20 });
  });

  it('refuses to read a missing credit figure as zero', async () => {
    const client = await clientAgainst((_req, res) => json(res, 200, { storage: { usage: 1 } }));
    await expect(client.fetchUsage(PREFIX)).rejects.toThrow(/no credit figures/);
  });

  it('clamps an over-quota account to 100', async () => {
    // The column has a 0-100 CHECK, and an account past its limit can report above it.
    const client = await clientAgainst((_req, res) => json(res, 200, { credits: { used_percent: 143.456 } }));
    await expect(client.fetchUsage(PREFIX)).resolves.toMatchObject({ creditsUsedPct: 100 });
  });

  it('rounds to the two decimals the column holds', async () => {
    const client = await clientAgainst((_req, res) => json(res, 200, { credits: { used_percent: 16.666 } }));
    await expect(client.fetchUsage(PREFIX)).resolves.toMatchObject({ creditsUsedPct: 16.67 });
  });

  it('authenticates with basic auth built from that account’s own credentials', async () => {
    const client = await clientAgainst((_req, res) => json(res, 200, { credits: { used_percent: 1 } }));
    await client.fetchUsage(PREFIX);
    const expected = `Basic ${Buffer.from('1234:not-a-real-secret').toString('base64')}`;
    expect(stub?.hits[0]?.headers.authorization).toBe(expected);
    expect(stub?.hits[0]?.path).toBe('/demo/usage');
  });

  it('fails closed, with no request made, when the account has no credentials here', async () => {
    const client = await clientAgainst((_req, res) => json(res, 200, { credits: { used_percent: 1 } }), {
      ...config(),
      accounts: {},
    });
    await expect(client.fetchUsage(PREFIX)).rejects.toBeInstanceOf(StorageAccountUnconfiguredError);
    expect(stub?.hits).toHaveLength(0);
  });
});

describe('fetchResource', () => {
  const input = { prefix: PREFIX, publicId: 'abc', resourceType: 'image' as const };

  it('reports the bytes and format Cloudinary actually received', async () => {
    const client = await clientAgainst((_req, res) =>
      json(res, 200, { public_id: 'abc', bytes: 4096, format: 'png', resource_type: 'image' }),
    );
    await expect(client.fetchResource(input)).resolves.toEqual({
      publicId: 'abc',
      bytes: 4096,
      format: 'png',
      resourceType: 'image',
    });
  });

  it('looks in the authenticated namespace', async () => {
    const client = await clientAgainst((_req, res) => json(res, 200, { bytes: 1, format: 'jpg' }));
    await client.fetchResource(input);
    expect(stub?.hits[0]?.path).toBe('/demo/resources/image/authenticated/abc');
  });

  it('returns undefined for a resource Cloudinary has never seen', async () => {
    // The ordinary "the client got a ticket and never used it" case, not an error.
    const client = await clientAgainst((_req, res) => json(res, 404, { error: { message: 'not found' } }));
    await expect(client.fetchResource(input)).resolves.toBeUndefined();
  });

  it('throws on any other failure, so the job retries rather than declaring the file missing', async () => {
    const client = await clientAgainst((_req, res) => json(res, 500, { error: { message: 'boom' } }));
    await expect(client.fetchResource(input)).rejects.toThrow();
  });
});

describe('destroyAsset', () => {
  const input = { prefix: PREFIX, publicId: 'abc', resourceType: 'image' as const };

  it('signs the destroy as an authenticated asset and form-encodes it', async () => {
    const client = await clientAgainst((_req, res) => json(res, 200, { result: 'ok' }));
    await expect(client.destroyAsset(input)).resolves.toBe(true);
    const hit = stub?.hits[0];
    expect(hit?.method).toBe('POST');
    expect(hit?.path).toBe('/demo/image/destroy');
    expect(hit?.headers['content-type']).toContain('application/x-www-form-urlencoded');
    const body = new URLSearchParams(hit?.body ?? '');
    expect(body.get('type')).toBe('authenticated');
    expect(body.get('public_id')).toBe('abc');
    expect(body.get('signature')).toBeTruthy();
  });

  it('treats a `not found` result as destroyed', async () => {
    // A replayed destroy job, or an asset whose upload never landed. Either way the bytes are gone,
    // which is the only thing the caller is asking about.
    const client = await clientAgainst((_req, res) => json(res, 200, { result: 'not found' }));
    await expect(client.destroyAsset(input)).resolves.toBe(true);
  });

  it('never throws when Cloudinary refuses', async () => {
    // The row is the durable record and the tombstone must land whether or not Cloudinary
    // cooperates. A failure here leaves an orphaned asset, logged for an operator to reconcile —
    // strictly better than a half-applied deletion.
    const client = await clientAgainst((_req, res) => json(res, 500, { error: { message: 'boom' } }));
    await expect(client.destroyAsset(input)).resolves.toBe(false);
  });

  it('never throws when the account has no credentials here', async () => {
    const client = await clientAgainst((_req, res) => json(res, 200, { result: 'ok' }), {
      ...config(),
      accounts: {},
    });
    await expect(client.destroyAsset(input)).resolves.toBe(false);
    expect(stub?.hits).toHaveLength(0);
  });
});
