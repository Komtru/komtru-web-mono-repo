// @vitest-environment jsdom
// T-121 (M2 and BVR1): the seller's business verification, and what a rejection says. The tab is the same screen in every
// state the application can be in; the rejection is its own screen.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellVerification } from '../src/sell/Verification';
import { expectNoAxeViolations } from './axe';
import { problem, status } from './support/account';
import { SHELL_RULES, answerWith, renderWithApi, type CallFn } from './support/trade';
import {
  IKEJA_ID,
  LAGOS_ID,
  allDocuments,
  application,
  payoutAccount,
  verifiedOwner,
} from './support/merchant';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const base = (app: Record<string, unknown> | null, accounts: unknown[] = []) => ({
  'GET /merchant/applications/me': app,
  'GET /verification/status': status(verifiedOwner),
  'GET /me/payout-accounts': { accounts },
});

const inReview = application({
  status: 'IN_REVIEW',
  form: { businessName: 'TechEdge NG', cacRcNumber: 'RC 1487XXX', addressLine: '12 Allen Avenue' },
  documents: allDocuments,
  submittedAt: '2026-11-18T09:00:00.000Z',
});

describe('Business verification (M2)', () => {
  it('shows each check as it stands while the application is with a person', async () => {
    answerWith(api.call, base(inReview, [payoutAccount()]));
    const { container } = renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByText('Owner identity')).toBeDefined();
    expect(screen.getByText('Business registration')).toBeDefined();
    expect(screen.getByText('Payout account')).toBeDefined();
    expect(screen.getByText('Storefront address')).toBeDefined();
    expect(screen.getAllByText('Verifying').length).toBe(2);
    expect(screen.getByText('GTBank •••• 5567')).toBeDefined();
    expect(screen.getByText(/Merchant verification gives you the “Verified Merchant” badge/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Resubmit/ })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('offers support and no edit while a person is reviewing the application', async () => {
    answerWith(api.call, base(inReview, [payoutAccount()]));
    renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByText('With our team')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Contact support' })).toBeDefined();
    expect(screen.queryByRole('link', { name: /Continue|Fix|Resubmit/ })).toBeNull();
  });

  it('shows Verified on every check once the shop is approved, and links to the live shop', async () => {
    answerWith(
      api.call,
      base({ ...inReview, status: 'APPROVED', decidedAt: '2026-11-19T08:00:00.000Z' }, [payoutAccount()]),
    );
    renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByText('Storefront address')).toBeDefined();
    expect(screen.getAllByText('Verified').length).toBe(4);
    expect(screen.getByRole('link', { name: 'See your merchant status' }).getAttribute('href')).toBe(
      '/account/verification/merchant/verified',
    );
  });

  it('asks for the named changes, each linked to the step that holds it', async () => {
    answerWith(
      api.call,
      base(
        application({
          ...inReview,
          status: 'CHANGES_REQUESTED',
          changesRequested: [
            { kind: 'FIELD', key: 'cacRcNumber', note: 'Check the RC number' },
            { kind: 'DOCUMENT', key: 'DIRECTOR_ID' },
          ],
        }),
        [payoutAccount()],
      ),
    );
    renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByText('Changes requested')).toBeDefined();
    expect(screen.getByText('Check the RC number')).toBeDefined();
    const fix = screen.getByRole('link', { name: 'Fix CAC registration number' });
    expect(fix.getAttribute('href')).toBe('/account/verification/merchant/verify-business');
    expect(screen.getByRole('link', { name: 'Fix Proprietor or director ID' }).getAttribute('href')).toBe(
      '/account/verification/merchant/verify-business',
    );
  });

  it('starts the application for someone who has not applied', async () => {
    answerWith(api.call, base(null));
    renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByText('Your business isn’t verified yet')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Start merchant verification' }).getAttribute('href')).toBe(
      '/account/verification/merchant/start',
    );
  });

  it('carries on a draft from the first step that is unfinished', async () => {
    answerWith(
      api.call,
      base(
        application({
          form: {
            businessName: 'TechEdge NG',
            addressLine: '12 Allen Avenue',
            stateId: LAGOS_ID,
            cityId: IKEJA_ID,
          },
        }),
      ),
    );
    renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByRole('link', { name: 'Continue your application' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Continue your application' }).getAttribute('href')).toBe(
      '/account/verification/merchant/category',
    );
  });

  it('shows a loading state, and a load failure with a retry', async () => {
    answerWith(api.call, { ...base(null), 'GET /merchant/applications/me': problem('INTERNAL', 500) });
    renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByText('Couldn’t load your verification')).toBeDefined();
  });
});

describe('Business verification rejected (BVR1)', () => {
  const rejected = application({
    status: 'REJECTED',
    form: { businessName: 'TechEdge NG', cacRcNumber: 'RC 1487XXX' },
    lastDecision: {
      outcome: 'REJECTED',
      reason: 'The CAC number submitted doesn’t match any active registration on file.',
      decidedAt: '2026-11-19T08:00:00.000Z',
    },
    decidedAt: '2026-11-19T08:00:00.000Z',
  });

  it('says the registration was not approved, why, and what still works', async () => {
    answerWith(api.call, base(rejected));
    const { container } = renderWithApi(api.call, <SellVerification />);
    expect(await screen.findByText('Not approved')).toBeDefined();
    expect(screen.getByText('Rejected')).toBeDefined();
    expect(screen.getByText('Why')).toBeDefined();
    expect(
      screen.getByText('The CAC number submitted doesn’t match any active registration on file.'),
    ).toBeDefined();
    expect(screen.getByText('Selling as a default seller')).toBeDefined();
    expect(screen.getByText('Limited until you are a merchant')).toBeDefined();
    expect(screen.getByText('Not available yet')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('starts again from the business verification step, and offers support', async () => {
    answerWith(api.call, base(rejected));
    renderWithApi(api.call, <SellVerification />);
    expect((await screen.findByRole('link', { name: 'Resubmit CAC details' })).getAttribute('href')).toBe(
      '/account/verification/merchant/verify-business',
    );
    expect(screen.getByRole('button', { name: 'Contact support' })).toBeDefined();
  });
});
