// The Cloudinary wire protocol's pure half (D3, M20 §6). This is what a request handler may call,
// because it is arithmetic: no network, no SDK, no process-wide config object.
//
// Every secret below is an obvious placeholder. The signatures are recomputed in the test from the
// documented rule rather than hard-coded, so the test states the rule instead of a magic string.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FilesConfig } from '../../../../src/config/env.js';
import { ApiError } from '../../../../src/platform/errors.js';
import { StorageAccountUnconfiguredError } from '../../../../src/modules/files/domain/errors.js';
import {
  credentialsFor,
  isAccountConfigured,
} from '../../../../src/modules/files/infrastructure/credentials.js';
import {
  buildDestroySignature,
  buildExpiringDownloadUrl,
  buildSignedDeliveryUrl,
  buildSignedUpload,
  buildStringToSign,
  signParams,
} from '../../../../src/modules/files/infrastructure/providers/cloudinary.signing.js';

const credentials = { cloudName: 'demo', apiKey: '1234', apiSecret: 'not-a-real-secret' };

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

const filesConfig = (accounts: FilesConfig['accounts']): FilesConfig => ({
  accounts,
  maxUploadBytes: 1024,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
});

describe('buildStringToSign', () => {
  it('sorts the parameters by name and joins them as a query string', () => {
    expect(buildStringToSign({ timestamp: 1, public_id: 'x', type: 'authenticated' })).toBe(
      'public_id=x&timestamp=1&type=authenticated',
    );
  });

  it('excludes the parameters Cloudinary does not sign', () => {
    // Including one produces a signature the server computes differently and rejects with a 401 that
    // says nothing about which parameter was wrong.
    expect(
      buildStringToSign({
        file: 'f',
        api_key: 'k',
        resource_type: 'image',
        cloud_name: 'c',
        signature: 's',
        timestamp: 1,
      }),
    ).toBe('timestamp=1');
  });

  it('drops an empty value rather than signing it', () => {
    expect(buildStringToSign({ timestamp: 1, folder: '' })).toBe('timestamp=1');
  });
});

describe('signParams', () => {
  it('appends the api_secret to the string-to-sign and SHA-1 hex encodes it', () => {
    expect(signParams({ timestamp: 1, public_id: 'x' }, 'not-a-real-secret')).toBe(
      sha1('public_id=x&timestamp=1not-a-real-secret'),
    );
  });
});

describe('buildSignedUpload', () => {
  const signed = buildSignedUpload({
    credentials,
    publicId: 'abc',
    resourceType: 'image',
    allowedFormats: ['jpg', 'png'],
    timestampSeconds: 1_700_000_000,
  });

  it('posts to the account’s own upload endpoint', () => {
    expect(signed.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(signed.cloudName).toBe('demo');
  });

  it('stores the asset in the private delivery mode (D3)', () => {
    // `type: 'authenticated'`. The default `upload` type makes every byte fetchable by anyone who
    // learns the public_id, and the access-control model above it decorative.
    expect(signed.params.type).toBe('authenticated');
  });

  it('pins our own opaque public_id and refuses to infer one from the filename', () => {
    expect(signed.params).toMatchObject({
      public_id: 'abc',
      use_filename: 'false',
      unique_filename: 'false',
      // A re-used ticket must not silently replace someone else's bytes.
      overwrite: 'false',
    });
  });

  it('enforces the format list at the door', () => {
    // The only enforcement that happens before the bytes are stored, which is what stops an HTML file
    // being uploaded as a KYC_DOCUMENT and becoming stored XSS the moment something renders it.
    expect(signed.params.allowed_formats).toBe('jpg,png');
  });

  it('signs exactly the parameters Cloudinary recognises, and no invented ones', () => {
    // Cloudinary rebuilds the string-to-sign from the parameters it knows and silently DROPS the
    // rest, so one invented parameter makes every upload a 401 — and the error names the string it
    // built, never the parameter you added. The old backend shipped `max_bytes`, which is not an
    // upload-API parameter at all, and it broke every upload while being documented as a size gate.
    expect(Object.keys(signed.params).sort()).toEqual([
      'allowed_formats',
      'api_key',
      'overwrite',
      'public_id',
      'signature',
      'timestamp',
      'type',
      'unique_filename',
      'use_filename',
    ]);
  });

  it('never puts the api_secret in what the client receives', () => {
    expect(JSON.stringify(signed)).not.toContain('not-a-real-secret');
    expect(signed.params.api_key).toBe('1234');
  });

  it('computes the signature over the signable parameters only', () => {
    const expected = sha1(
      'allowed_formats=jpg,png&overwrite=false&public_id=abc&timestamp=1700000000' +
        '&type=authenticated&unique_filename=false&use_filename=falsenot-a-real-secret',
    );
    expect(signed.params.signature).toBe(expected);
  });
});

describe('buildExpiringDownloadUrl', () => {
  it('puts expires_at inside the signature, so the URL genuinely stops working', () => {
    // Cloudinary offers two mechanisms and they are not equivalent: a signed DELIVERY url is
    // tamper-proof but has no expiry below the plan that includes token auth, while the Admin
    // `download` endpoint takes `expires_at` INSIDE the signature. D3 says "short-lived".
    const { url, expiresAt } = buildExpiringDownloadUrl({
      credentials,
      publicId: 'abc',
      resourceType: 'image',
      ttlSeconds: 300,
      nowSeconds: 1_000,
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.cloudinary.com/v1_1/demo/image/download');
    expect(parsed.searchParams.get('expires_at')).toBe('1300');
    expect(parsed.searchParams.get('type')).toBe('authenticated');
    expect(parsed.searchParams.get('api_key')).toBe('1234');
    expect(expiresAt).toEqual(new Date(1_300_000));
  });

  it('does not leak the secret into the query string', () => {
    const { url } = buildExpiringDownloadUrl({
      credentials,
      publicId: 'abc',
      resourceType: 'image',
      ttlSeconds: 300,
    });
    expect(url).not.toContain('not-a-real-secret');
  });
});

describe('buildSignedDeliveryUrl', () => {
  it('builds a tamper-proof inline URL whose signature covers the public_id', () => {
    // Nobody holding one can walk to another asset. Not time-limited on the free tier, which is why
    // only PUBLIC files get it — there, an unexpiring URL is what "public" already means.
    const signature = createHash('sha1').update('abcnot-a-real-secret').digest('base64url').slice(0, 8);
    expect(buildSignedDeliveryUrl({ credentials, publicId: 'abc', resourceType: 'image' })).toBe(
      `https://res.cloudinary.com/demo/image/authenticated/s--${signature}--/abc`,
    );
  });
});

describe('buildDestroySignature', () => {
  it('signs the destroy call as an authenticated asset', () => {
    // `type` is part of the string-to-sign: destroying without it addresses the public namespace and
    // succeeds while leaving the authenticated asset in place.
    const params = buildDestroySignature({ credentials, publicId: 'abc', timestampSeconds: 7 });
    expect(params).toMatchObject({
      public_id: 'abc',
      timestamp: '7',
      type: 'authenticated',
      api_key: '1234',
    });
    expect(params.signature).toBe(sha1('public_id=abc&timestamp=7&type=authenticatednot-a-real-secret'));
  });
});

describe('credentialsFor', () => {
  it('returns the account’s own credentials', () => {
    expect(credentialsFor(filesConfig({ CLOUDINARY_TRADE_1: credentials }), 'CLOUDINARY_TRADE_1')).toEqual(
      credentials,
    );
  });

  it('refuses with an error that names the three variables for the log, not for the client', () => {
    // A file_records row pointing at an account with no credentials cannot be served at all, and the
    // operator has no better signal than the exact variable names. They do NOT go in an ApiError's
    // `detail`, which is copied verbatim into the problem+json body: the person who just tried to
    // upload a photo has no use for CLOUDINARY_TRADE_2_API_SECRET, and an attacker has some.
    let thrown: unknown;
    try {
      credentialsFor(filesConfig({}), 'CLOUDINARY_TRADE_2');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorageAccountUnconfiguredError);
    const error = thrown as StorageAccountUnconfiguredError;
    expect(error.credentialEnvPrefix).toBe('CLOUDINARY_TRADE_2');
    expect(error.missingVariables).toEqual([
      'CLOUDINARY_TRADE_2_CLOUD_NAME',
      'CLOUDINARY_TRADE_2_API_KEY',
      'CLOUDINARY_TRADE_2_API_SECRET',
    ]);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('answers whether an account can be used in this environment without throwing', () => {
    const config = filesConfig({ CLOUDINARY_PROFILE: credentials });
    expect(isAccountConfigured(config, 'CLOUDINARY_PROFILE')).toBe(true);
    expect(isAccountConfigured(config, 'CLOUDINARY_TRADE_3')).toBe(false);
  });
});
