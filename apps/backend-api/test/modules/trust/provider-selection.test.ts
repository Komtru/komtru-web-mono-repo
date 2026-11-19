// The seam between "a provider attested this" and "nobody did". It is one switch, and it is the
// thing a real integration replaces.
import { describe, expect, it } from 'vitest';
import type { TrustConfig } from '../../../src/config/env.js';
import { KycProviderNotConfiguredError } from '../../../src/modules/trust/domain/errors.js';
import { kycProvider } from '../../../src/modules/trust/jobs/providers.js';
import { createLogger } from '../../../src/platform/logger.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);
const config = (overrides: Partial<TrustConfig> = {}): TrustConfig => ({
  provider: 'FAKE',
  requestTtlMinutes: 60,
  allowNameOverride: true,
  ...overrides,
});

describe('kycProvider', () => {
  it('builds the fake when the flag says FAKE', () => {
    expect(kycProvider(config(), logger).provider).toBe('FAKE');
  });

  it('warns at build time that the fake is attesting identities', () => {
    const lines: unknown[] = [];
    const recording = { ...logger, warn: (...args: unknown[]) => void lines.push(args) } as never;
    kycProvider(config(), recording);
    expect(JSON.stringify(lines)).toMatch(/fake/i);
  });

  it('names every missing credential when DOJAH is selected without them', () => {
    expect(() => kycProvider(config({ provider: 'DOJAH' }), logger)).toThrow(
      /DOJAH_APP_ID[\s\S]*DOJAH_SECRET_KEY[\s\S]*DOJAH_BASE_URL/,
    );
  });

  it('builds the Dojah adapter once its credentials are present', () => {
    const adapter = kycProvider(
      config({ provider: 'DOJAH', dojah: { appId: 'a', secretKey: 's', baseUrl: 'https://x.test' } }),
      logger,
    );
    expect(adapter.provider).toBe('DOJAH');
  });

  it('refuses every Dojah call until a real integration exists', async () => {
    const adapter = kycProvider(
      config({ provider: 'DOJAH', dojah: { appId: 'a', secretKey: 's', baseUrl: 'https://x.test' } }),
      logger,
    );
    await expect(
      adapter.verifyNin({ identifier: '1', firstName: 'A', lastName: 'B' }),
    ).rejects.toBeInstanceOf(KycProviderNotConfiguredError);
    await expect(
      adapter.verifyBvn({ identifier: '1', firstName: 'A', lastName: 'B' }),
    ).rejects.toBeInstanceOf(KycProviderNotConfiguredError);
    await expect(
      adapter.checkLiveness({ selfieStorageRef: 'x', matchedAgainst: 'NIN' }),
    ).rejects.toBeInstanceOf(KycProviderNotConfiguredError);
  });
});
