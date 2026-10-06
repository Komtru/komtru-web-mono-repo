// The fake is the only thing attesting identities until credentials exist (owner's decision Q7), so
// what it does is a product decision, not a test fixture. These tests pin the two properties that
// make it useful: it is reproducible, and it does not always say yes.
import { describe, expect, it } from 'vitest';
import { createFakeKycClient } from '../../../src/modules/trust/infrastructure/providers/fake-kyc.client.js';
import {
  livenessScriptFor,
  scriptFor,
} from '../../../src/modules/trust/infrastructure/providers/fake-script.js';

const claim = (identifier: string) => ({ identifier, firstName: 'Ada', lastName: 'Obi' });

describe('scriptFor', () => {
  it('scripts a distinct outcome per trailing digit, so every branch is reachable by hand', () => {
    expect(scriptFor('00000000000')).toBe('PENDING');
    expect(scriptFor('00000000001')).toBe('FAILED');
    expect(scriptFor('00000000002')).toBe('LOW_CONFIDENCE');
    expect(scriptFor('00000000003')).toBe('ERROR');
    expect(scriptFor('00000000004')).toBe('PASSED');
    expect(scriptFor('00000000009')).toBe('PASSED');
  });

  it('does not pass everything: across the digit space it fails, stalls and errors too', () => {
    const verdicts = new Set(
      Array.from({ length: 10_000 }, (_, i) => scriptFor(String(i).padStart(11, '0'))),
    );
    expect(verdicts).toEqual(new Set(['PASSED', 'FAILED', 'LOW_CONFIDENCE', 'PENDING', 'ERROR']));
  });
});

describe('livenessScriptFor', () => {
  it('reserves two selfie references for the failure paths', () => {
    expect(livenessScriptFor('00000000-0000-0000-0000-00000000000f')).toBe('FAILED');
    expect(livenessScriptFor('00000000-0000-0000-0000-00000000000e')).toBe('LOW_CONFIDENCE');
    expect(livenessScriptFor('00000000-0000-0000-0000-000000000001')).toBe('PASSED');
  });
});

describe('createFakeKycClient', () => {
  it('reports itself as FAKE, never as a real vendor', () => {
    expect(createFakeKycClient().provider).toBe('FAKE');
  });

  it('is deterministic: the same number twice is the same answer and the same reference', async () => {
    const fake = createFakeKycClient();
    expect(await fake.verifyNin(claim('12345678904'))).toEqual(await fake.verifyNin(claim('12345678904')));
  });

  it('returns a different reference for a different number', async () => {
    const fake = createFakeKycClient();
    const a = await fake.verifyNin(claim('12345678904'));
    const b = await fake.verifyNin(claim('12345678914'));
    expect(a.providerReference).not.toBe(b.providerReference);
  });

  it('separates NIN and BVN references for the same digits, as two real calls would', async () => {
    const fake = createFakeKycClient();
    const nin = await fake.verifyNin(claim('12345678904'));
    const bvn = await fake.verifyBvn(claim('12345678904'));
    expect(nin.providerReference).not.toBe(bvn.providerReference);
  });

  it('throws for the scripted provider error, so the job retry path is exercised', async () => {
    await expect(createFakeKycClient().verifyNin(claim('12345678903'))).rejects.toThrow(/fake kyc/i);
  });

  it('does not pin a passing score at 100 — a fake that is always certain teaches nothing', async () => {
    const fake = createFakeKycClient();
    const scores = await Promise.all(
      ['12345678904', '12345678905', '12345678906', '12345678907'].map(
        async (n) => (await fake.verifyNin(claim(n))).nameMatchScore,
      ),
    );
    expect(new Set(scores).size).toBeGreaterThan(1);
    for (const score of scores) expect(score).toBeGreaterThanOrEqual(85);
  });

  it('scores a LOW_CONFIDENCE pass below the passing band, so review is a real threshold', async () => {
    const result = await createFakeKycClient().verifyNin(claim('12345678902'));
    expect(result.verdict).toBe('LOW_CONFIDENCE');
    expect(result.nameMatchScore).toBeLessThan(85);
  });

  it('reports a failed liveness as not passed, with a reason', async () => {
    const result = await createFakeKycClient().checkLiveness({
      selfieStorageRef: '00000000-0000-0000-0000-00000000000f',
      matchedAgainst: 'NIN',
    });
    expect(result.livenessPassed).toBe(false);
    expect(result.failureReason).toBeTruthy();
  });
});
