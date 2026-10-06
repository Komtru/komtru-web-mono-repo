// How the module's own errors become HTTP, and why the same error becomes two different answers.
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../../src/platform/logger.js';
import { ApiError } from '../../../../src/platform/errors.js';
import {
  PoolExhaustedError,
  StorageAccountUnconfiguredError,
} from '../../../../src/modules/files/domain/errors.js';
import { translate, translateForOperator } from '../../../../src/modules/files/http/controllers.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

describe('translate (the consumer paths)', () => {
  it('tells a consumer nothing about the environment', () => {
    // ApiError.detail is copied verbatim into the problem+json body. Someone who just tried to
    // upload a photo has no use for CLOUDINARY_TRADE_2_API_SECRET, and an attacker has some.
    const problem = translate(logger, new StorageAccountUnconfiguredError('CLOUDINARY_TRADE_2'));
    expect(problem).toBeInstanceOf(ApiError);
    const api = problem as ApiError;
    expect(api.status).toBe(503);
    expect(api.code).toBe('FILE_STORAGE_UNAVAILABLE');
    expect(JSON.stringify(api)).not.toContain('CLOUDINARY_TRADE_2_API_SECRET');
  });

  it('answers 503 when a whole pool is at capacity', () => {
    const api = translate(logger, new PoolExhaustedError('TRADE_ASSET')) as ApiError;
    expect(api.status).toBe(503);
    expect(api.code).toBe('FILE_STORAGE_UNAVAILABLE');
  });

  it('passes anything else through untouched', () => {
    const original = new Error('something else');
    expect(translate(logger, original)).toBe(original);
  });
});

describe('translateForOperator (the runbook endpoint)', () => {
  it('names the three variables to the SUPER_ADMIN provisioning an account', () => {
    // D6's runbook is "provision a 6th account, insert its row, rotation resumes, no deploy". The
    // caller holds role.grant and is executing that runbook. Answering them "try again shortly"
    // leaves them with a registration that failed, uploads still failing, and nothing connecting
    // the two — which is exactly the dead end registerAccount's refusal exists to prevent.
    const api = translateForOperator(
      logger,
      new StorageAccountUnconfiguredError('CLOUDINARY_TRADE_4'),
    ) as ApiError;
    expect(api.status).toBe(400);
    expect(api.code).toBe('VALIDATION_FAILED');
    expect(api.detail).toContain('CLOUDINARY_TRADE_4_CLOUD_NAME');
    expect(api.detail).toContain('CLOUDINARY_TRADE_4_API_KEY');
    expect(api.detail).toContain('CLOUDINARY_TRADE_4_API_SECRET');
  });

  it('falls back to the consumer translation for everything else', () => {
    const api = translateForOperator(logger, new PoolExhaustedError('TRADE_ASSET')) as ApiError;
    expect(api.status).toBe(503);
  });
});
