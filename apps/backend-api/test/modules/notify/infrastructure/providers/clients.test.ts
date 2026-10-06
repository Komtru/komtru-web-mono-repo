// The three provider adapters, against an in-process stub rather than a mocked fetch, so retries,
// auth headers and error classification are exercised for real. Nothing here ever reaches Mailjet,
// Termii or FCM.
import { generateKeyPairSync } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../../../src/config/env.js';
import { createLogger } from '../../../../../src/platform/logger.js';
import { ProviderHttpError } from '../../../../../src/platform/providers/http.js';
import { sendEmail } from '../../../../../src/modules/notify/infrastructure/providers/mailjet.client.js';
import { sendSms } from '../../../../../src/modules/notify/infrastructure/providers/termii.client.js';
import { sendPush } from '../../../../../src/modules/notify/infrastructure/providers/fcm.client.js';
import { startStubServer, type StubServer } from '../../../../support/stub-server.js';

const logger = createLogger(
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://x@localhost/x',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

let stub: StubServer | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const json =
  (body: unknown, status = 200) =>
  (_req: unknown, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

describe('mailjet client', () => {
  it('sends basic auth, the sender and the message, and returns the message id', async () => {
    stub = await startStubServer(json({ Messages: [{ Status: 'success', To: [{ MessageID: 42 }] }] }));

    const result = await sendEmail(logger, {
      baseUrl: stub.url,
      apiKey: 'key',
      apiSecret: 'secret',
      fromEmail: 'no-reply@komtru.com',
      fromName: 'Komtru',
      sandbox: false,
      to: 'ada@example.com',
      subject: 'Hello',
      text: 'Body',
    });

    const hit = stub.hits[0];
    expect(hit?.path).toBe('/v3.1/send');
    expect(hit?.headers.authorization).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
    const body = JSON.parse(hit?.body ?? '{}') as {
      SandboxMode?: boolean;
      Messages: { From: { Email: string }; To: { Email: string }[]; Subject: string; TextPart: string }[];
    };
    expect(body.SandboxMode).toBeUndefined();
    expect(body.Messages[0]).toMatchObject({
      From: { Email: 'no-reply@komtru.com', Name: 'Komtru' },
      To: [{ Email: 'ada@example.com' }],
      Subject: 'Hello',
      TextPart: 'Body',
    });
    expect(result.providerReference).toBe('42');
  });

  it('asks for sandbox mode when told to', async () => {
    stub = await startStubServer(json({ Messages: [{ Status: 'success' }] }));

    await sendEmail(logger, {
      baseUrl: stub.url,
      apiKey: 'key',
      apiSecret: 'secret',
      fromEmail: 'no-reply@komtru.com',
      fromName: 'Komtru',
      sandbox: true,
      to: 'ada@example.com',
      subject: 'Hello',
      text: 'Body',
    });

    expect(JSON.parse(stub.hits[0]?.body ?? '{}')).toMatchObject({ SandboxMode: true });
  });

  it('rejects when mailjet refuses the message, without retrying it', async () => {
    stub = await startStubServer(json({ Messages: [{ Status: 'error' }] }));

    await expect(
      sendEmail(logger, {
        baseUrl: stub.url,
        apiKey: 'key',
        apiSecret: 'secret',
        fromEmail: 'no-reply@komtru.com',
        fromName: 'Komtru',
        sandbox: false,
        to: 'ada@example.com',
        subject: 'Hello',
        text: 'Body',
      }),
    ).rejects.toThrow(/mailjet/i);
    expect(stub.hits).toHaveLength(1);
  });
});

describe('termii client', () => {
  it('posts the message and returns the provider id', async () => {
    stub = await startStubServer(json({ message_id: 'tm-1', message: 'Successfully Sent' }));

    const result = await sendSms(logger, {
      baseUrl: stub.url,
      apiKey: 'key',
      senderId: 'Komtru',
      to: '+2348012345678',
      text: 'Your code is 123456',
    });

    const hit = stub.hits[0];
    expect(hit?.path).toBe('/api/sms/send');
    expect(JSON.parse(hit?.body ?? '{}')).toMatchObject({
      to: '+2348012345678',
      from: 'Komtru',
      sms: 'Your code is 123456',
      type: 'plain',
      channel: 'generic',
      api_key: 'key',
    });
    expect(result.providerReference).toBe('tm-1');
  });

  it('does not repeat a send that the provider answered with a 500', async () => {
    stub = await startStubServer(json({ message: 'boom' }, 500));

    await expect(
      sendSms(logger, {
        baseUrl: stub.url,
        apiKey: 'key',
        senderId: 'Komtru',
        to: '+2348012345678',
        text: 'hi',
      }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    // One hit, not three: a message send is not idempotent, so the queue's backoff is the only
    // retry it gets.
    expect(stub.hits).toHaveLength(1);
  });
});

describe('fcm client', () => {
  const push = (overrides: Partial<Parameters<typeof sendPush>[1]> = {}) => ({
    baseUrl: stub?.url ?? '',
    tokenUri: `${stub?.url ?? ''}/token`,
    projectId: 'komtru',
    clientEmail: 'notify@komtru.iam.gserviceaccount.com',
    privateKey: pem,
    tokens: ['token-a'],
    title: 'New sign-in',
    body: 'From Lagos',
    ...overrides,
  });

  it('exchanges a signed assertion for a token, then sends one message per device', async () => {
    stub = await startStubServer((req, res) => {
      if (req.url === '/token') return json({ access_token: 'at-1', expires_in: 3600 })(req, res);
      return json({ name: 'projects/komtru/messages/1' })(req, res);
    });

    const result = await sendPush(logger, push({ tokens: ['token-a', 'token-b'] }));

    expect(stub.hits[0]?.path).toBe('/token');
    expect(stub.hits[0]?.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(stub.hits.slice(1).map((h) => h.path)).toEqual([
      '/v1/projects/komtru/messages:send',
      '/v1/projects/komtru/messages:send',
    ]);
    expect(stub.hits[1]?.headers.authorization).toBe('Bearer at-1');
    expect(JSON.parse(stub.hits[1]?.body ?? '{}')).toMatchObject({
      message: { token: 'token-a', notification: { title: 'New sign-in', body: 'From Lagos' } },
    });
    expect(result).toMatchObject({ providerReference: 'projects/komtru/messages/1', invalidTokens: [] });
  });

  it('fetches the access token once for two sends', async () => {
    stub = await startStubServer((req, res) => {
      if (req.url === '/token') return json({ access_token: 'at-2', expires_in: 3600 })(req, res);
      return json({ name: 'projects/komtru/messages/2' })(req, res);
    });

    await sendPush(logger, push());
    await sendPush(logger, push());

    expect(stub.hits.filter((h) => h.path === '/token')).toHaveLength(1);
  });

  it('reports a token FCM no longer knows instead of failing the whole send', async () => {
    stub = await startStubServer((req, res) => {
      if (req.url === '/token') return json({ access_token: 'at-3', expires_in: 3600 })(req, res);
      return json({ error: { status: 'UNREGISTERED', message: 'gone' } }, 404)(req, res);
    });

    const result = await sendPush(logger, push({ tokens: ['stale'] }));

    expect(result.invalidTokens).toEqual(['stale']);
    expect(result.providerReference).toBeUndefined();
  });

  it('rejects when every device fails for a reason a retry could fix', async () => {
    stub = await startStubServer((req, res) => {
      if (req.url === '/token') return json({ access_token: 'at-4', expires_in: 3600 })(req, res);
      return json({ error: { status: 'INTERNAL' } }, 503)(req, res);
    });

    await expect(sendPush(logger, push())).rejects.toBeInstanceOf(ProviderHttpError);
  });
});
