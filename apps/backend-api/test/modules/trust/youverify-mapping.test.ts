// Youverify's JSON onto the adapter's result types, tested against responses the sandbox actually
// returned on 2026-11-19 rather than against the documentation.
//
// The case that matters most is `refuses to pass an unvalidated identity`. Youverify returns
// `allValidationPassed: true` when no `validations.data` was sent — "nothing was checked, so
// nothing failed" — and `dataValidation: true` only means validation RAN. An implementation that
// trusted either aggregate would attest a level 2 identity for anyone who typed a stranger's NIN.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  mapIdentity,
  type YouverifyIdentityResponse,
} from '../../../src/modules/trust/infrastructure/providers/youverify.mapping.js';
import {
  bvnRequest,
  companyRequest,
  ninRequest,
} from '../../../src/modules/trust/infrastructure/providers/youverify.requests.js';

const fixture = (name: string): YouverifyIdentityResponse => {
  const file = readFileSync(new URL(`../../fixtures/youverify/${name}.json`, import.meta.url), 'utf8');
  const parsed = JSON.parse(file) as { response: YouverifyIdentityResponse };
  return parsed.response;
};

const claim = { identifier: '11111111111', firstName: 'Sarah', lastName: 'Doe' };

describe('mapIdentity', () => {
  it('refuses to pass an unvalidated identity, however cheerful the aggregates look', () => {
    // The real `nin-found` response: status found, allValidationPassed TRUE, and no `validations`
    // block at all, because the probe sent no claim. This must never be a PASS.
    const result = mapIdentity(fixture('nin-found'));
    expect(result.verdict).not.toBe('PASSED');
    expect(result.verdict).toBe('LOW_CONFIDENCE');
  });

  it('maps a not-found identity to a rejection the user can act on', () => {
    const result = mapIdentity(fixture('nin-not-found'));
    expect(result.verdict).toBe('FAILED');
    expect(result.failureCode).toBe('ID_NOT_FOUND');
  });

  it('maps a name mismatch to ID_NAME_MISMATCH, not to a generic failure', () => {
    const result = mapIdentity(fixture('nin-name-mismatch-full'));
    expect(result.verdict).toBe('FAILED');
    expect(result.failureCode).toBe('ID_NAME_MISMATCH');
  });

  it('does not read dataValidation as a pass — the mismatch fixture has it TRUE', () => {
    expect(fixture('nin-name-mismatch-full').data.dataValidation).toBe(true);
    expect(mapIdentity(fixture('nin-name-mismatch-full')).verdict).toBe('FAILED');
  });

  it('passes when every field the claim named validated', () => {
    const response = fixture('nin-name-mismatch-full');
    const passing: YouverifyIdentityResponse = {
      ...response,
      data: {
        ...response.data,
        allValidationPassed: true,
        validations: {
          data: {
            firstName: { validated: true, value: 'Sarah' },
            lastName: { validated: true, value: 'Doe' },
          },
        },
      },
    };
    expect(mapIdentity(passing).verdict).toBe('PASSED');
  });

  it('separates a date-of-birth mismatch from a name mismatch', () => {
    const response = fixture('nin-name-mismatch-full');
    const dobOnly: YouverifyIdentityResponse = {
      ...response,
      data: {
        ...response.data,
        validations: {
          data: {
            firstName: { validated: true, value: 'Sarah' },
            lastName: { validated: true, value: 'Doe' },
            dateOfBirth: { validated: false, value: '1988-04-04' },
          },
        },
      },
    };
    const result = mapIdentity(dobOnly);
    expect(result.verdict).toBe('FAILED');
    expect(result.failureCode).toBe('ID_DOB_MISMATCH');
    expect(result.dobMatch).toBe(false);
  });

  it('carries the provider record id as the retrieval key', () => {
    expect(mapIdentity(fixture('bvn-found')).providerReference).toBe(fixture('bvn-found').data.id);
  });
});

describe('request construction', () => {
  it('always sends the claim, because omitting it is what makes an unvalidated pass possible', () => {
    const { body } = ninRequest('https://x.test', claim);
    expect(body.validations?.data?.firstName).toBe('Sarah');
    expect(body.validations?.data?.lastName).toBe('Doe');
    expect(body.isSubjectConsent).toBe(true);
    expect(body.id).toBe('11111111111');
  });

  it('spells premiumNin the way the API accepts — premiumNIN is a 400', () => {
    expect(Object.keys(ninRequest('https://x.test', claim).body)).not.toContain('premiumNIN');
  });

  it('sends a date of birth only when the claim carries one', () => {
    expect(ninRequest('https://x.test', claim).body.validations?.data?.dateOfBirth).toBeUndefined();
    const withDob = ninRequest('https://x.test', { ...claim, dateOfBirth: '1988-04-04' });
    expect(withDob.body.validations?.data?.dateOfBirth).toBe('1988-04-04');
  });

  it('points NIN and BVN at their own endpoints', () => {
    expect(ninRequest('https://x.test', claim).url).toBe('https://x.test/v2/api/identity/ng/nin');
    expect(bvnRequest('https://x.test', claim).url).toBe('https://x.test/v2/api/identity/ng/bvn');
  });

  it('authenticates with the token header, not a bearer scheme', () => {
    expect(ninRequest('https://x.test', claim, 'secret').headers.token).toBe('secret');
  });

  it('sends the RC number with its entity prefix, which the provider requires', () => {
    expect(companyRequest('https://x.test', 'RC1487322').body.registrationNumber).toBe('RC1487322');
  });
});
