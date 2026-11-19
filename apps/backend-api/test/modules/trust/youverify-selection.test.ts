// Selecting Youverify, and what it admits it cannot do yet.
//
// The account's API key carries NIN, BVN and bank-account scopes but NOT company lookup — both CAC
// endpoints answered 403 on 2026-11-19 (see test/fixtures/youverify/company-basic-403.json). A
// method with no entitlement behind it must refuse by name rather than fail somewhere downstream.
import { describe, expect, it } from 'vitest';
import type { TrustConfig, YouverifyCredentials } from '../../../src/config/env.js';
import { KycProviderNotConfiguredError } from '../../../src/modules/trust/domain/errors.js';
import { kycProvider } from '../../../src/modules/trust/jobs/providers.js';
import { createLogger } from '../../../src/platform/logger.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const credentials: YouverifyCredentials = {
  secretToken: 'tok',
  publicMerchantKey: 'mk',
  webhookSecret: 'whs',
  baseUrl: 'https://api.sandbox.youverify.co',
};

const config = (overrides: Partial<TrustConfig> = {}): TrustConfig => ({
  provider: 'FAKE',
  requestTtlMinutes: 60,
  allowNameOverride: true,
  ...overrides,
});

describe('kycProvider — YOUVERIFY', () => {
  it('names every missing credential when YOUVERIFY is selected without them', () => {
    expect(() => kycProvider(config({ provider: 'YOUVERIFY' }), logger)).toThrow(
      /YOUVERIFY_SECRET_TOKEN[\s\S]*YOUVERIFY_PUBLIC_MERCHANT_KEY[\s\S]*YOUVERIFY_WEBHOOK_SECRET[\s\S]*YOUVERIFY_BASE_URL/,
    );
  });

  it('throws KycProviderNotConfiguredError, not a bare Error', () => {
    expect(() => kycProvider(config({ provider: 'YOUVERIFY' }), logger)).toThrow(
      KycProviderNotConfiguredError,
    );
  });

  it('builds the adapter once all four credentials are present', () => {
    const adapter = kycProvider(config({ provider: 'YOUVERIFY', youverify: credentials }), logger);
    expect(adapter.provider).toBe('YOUVERIFY');
  });

  it('does not warn about a fake when a real provider is selected', () => {
    const lines: unknown[] = [];
    const recording = { ...logger, warn: (...args: unknown[]) => void lines.push(args) } as never;
    kycProvider(config({ provider: 'YOUVERIFY', youverify: credentials }), recording);
    expect(JSON.stringify(lines)).not.toMatch(/fake/i);
  });

  it('refuses the two checks the key has no entitlement for, by name', async () => {
    const adapter = kycProvider(config({ provider: 'YOUVERIFY', youverify: credentials }), logger);
    await expect(
      adapter.verifyBusiness({ rcNumber: 'RC1487322', firstName: 'Ada', lastName: 'Obi' }),
    ).rejects.toThrow(/company|cac/i);
    await expect(
      adapter.verifyBankAccountName({ accountNumber: '1', bankCode: '058', expectedName: 'X' }),
    ).rejects.toThrow(/bank/i);
  });

  it('rejects rather than throwing synchronously, so a refusal is a failed job not a crashed worker', async () => {
    const adapter = kycProvider(config({ provider: 'YOUVERIFY', youverify: credentials }), logger);
    let settled: Promise<unknown> | undefined;
    expect(() => {
      settled = adapter.verifyBusiness({ rcNumber: 'RC1', firstName: 'A', lastName: 'B' });
    }).not.toThrow();
    await expect(settled).rejects.toBeInstanceOf(KycProviderNotConfiguredError);
  });
});
