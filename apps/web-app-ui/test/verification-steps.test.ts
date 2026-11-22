import type { VerificationStatus } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import {
  CONTACT_SECTION_HREF,
  IDENTITY_SECTION_HREF,
  stepsOwed,
  type Facts,
} from '../src/home/verificationSteps';

const channel = (verified: boolean, present = true) => ({
  present,
  masked: present ? 'x•••' : null,
  verified,
});

const facts = (over: Partial<Facts> & { email?: boolean; phone?: boolean } = {}): Facts => ({
  contacts: { email: channel(over.email ?? true), phone: channel(over.phone ?? true) },
  verificationLevel: over.verificationLevel ?? 'CONTACT_VERIFIED',
  ...(over.contacts === undefined ? {} : { contacts: over.contacts }),
});

const status = (over: Partial<VerificationStatus> = {}): VerificationStatus => ({
  level: 'CONTACT_VERIFIED',
  levelNumber: 1,
  levelAttainedAt: null,
  requirements: { identifier: false, liveness: false, business: false, businessBankAccount: false },
  inFlight: [],
  rejections: [],
  ...over,
});

const rejection = (type: string, outcome: 'FAILED' | 'REJECTED' | 'UNDER_REVIEW' = 'FAILED') =>
  ({
    requestId: '00000000-0000-4000-8000-000000000001',
    type,
    decidedAt: '2026-11-20T10:00:00.000Z',
    reason: {
      code: 'X',
      surface: 'VF1',
      outcome,
      whyHeading: '',
      why: '',
      remedy: 'RESUBMIT',
      identityLevelAffected: true,
    },
  }) as VerificationStatus['rejections'][number];

const ids = (steps: { id: string }[]) => steps.map((step) => step.id);

// F-084: which verification steps are still owed, per dashboard side.
describe('the verification steps still owed', () => {
  it('asks a person who signed up with a phone to confirm their email, naming why', () => {
    const [step] = stepsOwed(facts({ email: false }), status(), [], 'BUYER');
    expect(step?.id).toBe('email');
    expect(step?.title).toBe('Confirm your email');
    expect(step?.reason).toMatch(/^You signed up with your phone\./);
    expect(step?.required).toBe(true);
    expect(step?.href).toBe(CONTACT_SECTION_HREF);
  });

  it('asks a person who signed up with an email to confirm their phone', () => {
    const [step] = stepsOwed(facts({ phone: false }), status(), [], 'SELLER');
    expect(step?.id).toBe('phone');
    expect(step?.reason).toMatch(/^You signed up with your email\./);
  });

  it('says "add" when there is no address on the channel at all', () => {
    const steps = stepsOwed(
      facts({ contacts: { email: channel(false, false), phone: channel(true) } }),
      status(),
      [],
      'BUYER',
    );
    expect(steps[0]?.title).toBe('Add and confirm your email');
  });

  it('makes ID required on Sell and recommended on Buy', () => {
    const sell = stepsOwed(facts(), status(), [], 'SELLER');
    const buy = stepsOwed(facts(), status(), [], 'BUYER');
    expect(ids(sell)).toEqual(['identity']);
    expect(sell[0]?.required).toBe(true);
    expect(sell[0]?.href).toBe(IDENTITY_SECTION_HREF);
    expect(buy[0]?.required).toBe(false);
    expect(buy[0]?.reason).toMatch(/^Recommended\./);
  });

  it('owes nothing once contacts are confirmed and the ID is verified, business verification included', () => {
    expect(stepsOwed(facts({ verificationLevel: 'IDENTITY_VERIFIED' }), status(), [], 'SELLER')).toEqual([]);
    expect(stepsOwed(facts({ verificationLevel: 'BUSINESS_VERIFIED' }), status(), [], 'SELLER')).toEqual([]);
  });

  it('lists contacts before ID', () => {
    expect(ids(stepsOwed(facts({ email: false, phone: false }), status(), [], 'SELLER'))).toEqual([
      'email',
      'phone',
      'identity',
    ]);
  });

  it('reads an ID check on its way as in review, and a failed one as rejected', () => {
    const inFlight = status({
      inFlight: [
        {
          requestId: '00000000-0000-4000-8000-000000000002',
          type: 'BVN',
          status: 'PENDING',
          submittedAt: '2026-11-21T10:00:00.000Z',
          expiresAt: '2026-11-22T10:00:00.000Z',
        },
      ],
    });
    expect(stepsOwed(facts(), inFlight, [], 'SELLER')[0]?.state).toBe('in_review');
    expect(stepsOwed(facts(), status(), [rejection('LIVENESS')], 'SELLER')[0]?.state).toBe('rejected');
    expect(stepsOwed(facts(), status(), [rejection('NIN', 'UNDER_REVIEW')], 'SELLER')[0]?.state).toBe(
      'in_review',
    );
  });

  it('ignores checks that are not about the ID', () => {
    expect(stepsOwed(facts(), status(), [rejection('CAC')], 'SELLER')[0]?.state).toBe('todo');
  });
});
