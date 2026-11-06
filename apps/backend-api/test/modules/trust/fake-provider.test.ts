// The fake is the only thing attesting identities until credentials exist (owner's decision Q7), so
// what it does is a product decision, not a test fixture. These tests pin the two properties that
// make it useful: it is reproducible, and it does not always say yes.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDojahClient } from '../../../src/modules/trust/infrastructure/providers/dojah.client.js';
import { createFakeKycClient } from '../../../src/modules/trust/infrastructure/providers/fake-kyc.client.js';
import {
  bankMatchScriptFor,
  businessScriptFor,
  livenessScriptFor,
  registeredNameFor,
  scriptFor,
} from '../../../src/modules/trust/infrastructure/providers/fake-script.js';

const claim = (identifier: string) => ({ identifier, firstName: 'Ada', lastName: 'Obi' });
const identityClaim = claim;

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

  it('is deterministic in its VERDICT and score: the same number twice gets the same answer', async () => {
    const fake = createFakeKycClient();
    const a = await fake.verifyNin(claim('12345678904'));
    const b = await fake.verifyNin(claim('12345678904'));
    expect(a.verdict).toBe(b.verdict);
    expect(a.nameMatchScore).toBe(b.nameMatchScore);
  });

  it('does not derive the reference from the number, which would make the column brute-forceable', async () => {
    // The reference is persisted in `nin_verifications.provider_reference`, which D1 lists among the
    // three things it is SAFE to keep. A truncated unkeyed sha256 of an eleven-digit number is not
    // safe: the whole space is 10^11, so that column would be a lookup table for the very value the
    // keyed hash beside it exists to protect. A real provider's reference is random per call; so is
    // this one.
    const fake = createFakeKycClient();
    const first = await fake.verifyNin(claim('12345678904'));
    const second = await fake.verifyNin(claim('12345678904'));
    expect(first.providerReference).not.toBe(second.providerReference);

    const digest = createHash('sha256').update('nin:12345678904').digest('hex');
    expect(first.providerReference).not.toContain(digest.slice(0, 16));
    expect(first.providerReference).not.toContain('12345678904');
  });

  it('still marks the reference as the fake’s, so a row is never mistaken for a real vendor call', async () => {
    const result = await createFakeKycClient().verifyNin(claim('12345678904'));
    expect(result.providerReference).toMatch(/^fake_nin_/);
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

describe('businessScriptFor', () => {
  /**
   * The first four endings are `scriptFor`'s, deliberately: one convention across the adapter means
   * a developer who knows `...3` throws for a NIN does not have to learn a second table for a CAC.
   * The three after them are the branches only a KYB check has.
   */
  it('keeps the shared endings and adds the three only a CAC check has', () => {
    expect(businessScriptFor('RC0')).toBe('PENDING');
    expect(businessScriptFor('RC1')).toBe('NOT_FOUND');
    expect(businessScriptFor('RC2')).toBe('LOW_CONFIDENCE');
    expect(businessScriptFor('RC3')).toBe('ERROR');
    expect(businessScriptFor('RC4')).toBe('INACTIVE');
    expect(businessScriptFor('RC5')).toBe('OFFICER_MISMATCH');
    expect(businessScriptFor('RC6')).toBe('OFFICER_UNKNOWN');
    expect(businessScriptFor('RC7')).toBe('ACTIVE');
  });

  it('reaches every branch the business decision has to handle', () => {
    const outcomes = new Set(Array.from({ length: 100 }, (_, i) => businessScriptFor(`RC${String(i)}`)));
    expect(outcomes).toEqual(
      new Set([
        'PENDING',
        'NOT_FOUND',
        'LOW_CONFIDENCE',
        'ERROR',
        'INACTIVE',
        'OFFICER_MISMATCH',
        'OFFICER_UNKNOWN',
        'ACTIVE',
      ]),
    );
  });
});

describe('registeredNameFor', () => {
  it('is stable for one RC number, so a bank match can be run against it afterwards', () => {
    expect(registeredNameFor('1487322')).toBe(registeredNameFor('1487322'));
    expect(registeredNameFor('1487322')).not.toBe(registeredNameFor('1487323'));
  });

  it('says FAKE in the name, so a seeded merchant is never mistaken for a real company', () => {
    expect(registeredNameFor('1487322')).toMatch(/FAKE/);
  });
});

describe('bankMatchScriptFor', () => {
  it('scripts an outcome per trailing digit of the account number', () => {
    expect(bankMatchScriptFor('0000000000')).toBe('PENDING');
    expect(bankMatchScriptFor('0000000001')).toBe('ACCOUNT_NOT_FOUND');
    expect(bankMatchScriptFor('0000000002')).toBe('FUZZY');
    expect(bankMatchScriptFor('0000000003')).toBe('ERROR');
    expect(bankMatchScriptFor('0000000005')).toBe('NAME_MISMATCH');
    expect(bankMatchScriptFor('0000000007')).toBe('EXACT');
  });
});

const business = (rcNumber: string) => ({ rcNumber, firstName: 'Ada', lastName: 'Obi' });

describe('createFakeKycClient.verifyBusiness', () => {
  it('passes an active registration whose submitter is an officer', async () => {
    const result = await createFakeKycClient().verifyBusiness(business('1487327'));
    expect(result).toMatchObject({
      verdict: 'PASSED',
      cacStatus: 'active',
      officersMatch: true,
      registeredBusinessName: registeredNameFor('1487327'),
    });
    expect(result.providerReference).toMatch(/^fake_cac_/);
  });

  /**
   * The case `decideBusinessOutcome` exists for: a PASSED verdict on a registration that is real and
   * not active. `decideIdentityOutcome`'s verdict-only switch would have approved it.
   */
  it('returns a PASSED verdict on an inactive registration, with the status that refuses it', async () => {
    const result = await createFakeKycClient().verifyBusiness(business('1487324'));
    expect(result).toMatchObject({ verdict: 'PASSED', cacStatus: 'inactive', failureCode: 'CAC_INACTIVE' });
  });

  it('reports an officer mismatch as a real registration the submitter does not own', async () => {
    const result = await createFakeKycClient().verifyBusiness(business('1487325'));
    expect(result).toMatchObject({
      verdict: 'PASSED',
      cacStatus: 'active',
      officersMatch: false,
      failureCode: 'CAC_OFFICER_MISMATCH',
    });
  });

  it('leaves officersMatch undefined when the registry does not say, rather than guessing false', async () => {
    const result = await createFakeKycClient().verifyBusiness(business('1487326'));
    expect(result.verdict).toBe('PASSED');
    expect(result.officersMatch).toBeUndefined();
  });

  it('maps a missing registration onto the code BVR1 renders', async () => {
    const result = await createFakeKycClient().verifyBusiness(business('1487321'));
    expect(result).toMatchObject({ verdict: 'FAILED', failureCode: 'CAC_NOT_FOUND' });
    expect(result.registeredBusinessName).toBeUndefined();
  });

  it('throws on the scripted error, so the job retry path is exercised', async () => {
    await expect(createFakeKycClient().verifyBusiness(business('1487323'))).rejects.toThrow(/fake kyc/i);
  });

  it('never echoes the submitter’s name back, which this module stores nowhere', async () => {
    const result = await createFakeKycClient().verifyBusiness(business('1487327'));
    expect(JSON.stringify(result)).not.toMatch(/Ada|Obi/);
  });
});

const account = (accountNumber: string, expectedName = registeredNameFor('1487327')) => ({
  accountNumber,
  bankCode: '058',
  expectedName,
});

describe('createFakeKycClient.verifyBankAccountName', () => {
  it('resolves an exact match to the expected name itself', async () => {
    const expectedName = registeredNameFor('1487327');
    const result = await createFakeKycClient().verifyBankAccountName(account('0123456787', expectedName));
    expect(result).toMatchObject({
      verdict: 'PASSED',
      matchResult: 'EXACT',
      resolvedAccountName: expectedName,
    });
    expect(result.providerReference).toMatch(/^fake_bank_/);
  });

  it('returns a near-miss the decision sends to a human, not a pass', async () => {
    const result = await createFakeKycClient().verifyBankAccountName(account('0123456782'));
    expect(result.matchResult).toBe('FUZZY_MATCH');
    expect(result.resolvedAccountName).not.toBe(registeredNameFor('1487327'));
    expect(result.resolvedAccountName).toBeTruthy();
  });

  it('distinguishes an unresolvable account from one held by somebody else', async () => {
    const fake = createFakeKycClient();
    const missing = await fake.verifyBankAccountName(account('0123456781'));
    expect(missing).toMatchObject({ matchResult: 'MISMATCH', failureCode: 'BANK_ACCOUNT_NOT_FOUND' });
    expect(missing.resolvedAccountName).toBeUndefined();

    const other = await fake.verifyBankAccountName(account('0123456785'));
    expect(other).toMatchObject({ matchResult: 'MISMATCH', failureCode: 'BANK_NAME_MISMATCH' });
    expect(other.resolvedAccountName).toBeTruthy();
  });

  it('never echoes the account number, which §6.5 keeps only four digits of', async () => {
    const result = await createFakeKycClient().verifyBankAccountName(account('0123456787'));
    expect(JSON.stringify(result)).not.toContain('0123456787');
  });

  it('throws on the scripted error', async () => {
    await expect(createFakeKycClient().verifyBankAccountName(account('0123456783'))).rejects.toThrow(
      /fake kyc/i,
    );
  });
});

describe('createDojahClient', () => {
  it('refuses every one of D3’s five methods rather than pretending to answer', async () => {
    const dojah = createDojahClient({} as never);
    // Awaited one at a time rather than built into an array first: five pending rejections sitting
    // in a list are five unhandled rejections until the loop reaches them, which vitest reports as
    // errors on the file rather than as the assertion passing.
    const calls: (() => Promise<unknown>)[] = [
      () => dojah.verifyNin(identityClaim('12345678904')),
      () => dojah.verifyBvn(identityClaim('12345678904')),
      () => dojah.checkLiveness({ selfieStorageRef: 'x', matchedAgainst: 'NIN' }),
      () => dojah.verifyBusiness(business('1487327')),
      () => dojah.verifyBankAccountName(account('0123456787')),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(/DOJAH/);
  });
});
