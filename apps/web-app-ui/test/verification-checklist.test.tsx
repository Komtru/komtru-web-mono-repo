// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationChecklist } from '../src/home/VerificationChecklist';
import { expectNoAxeViolations } from './axe';
import { me } from './support/account';
import { answerWith, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

const status = (over: Record<string, unknown> = {}) => ({
  level: 'CONTACT_VERIFIED',
  levelNumber: 1,
  levelAttainedAt: null,
  requirements: { identifier: false, liveness: false, business: false, businessBankAccount: false },
  inFlight: [],
  rejections: [],
  ...over,
});

const phoneFirst = me(
  {},
  {
    verificationLevel: 'UNVERIFIED',
    contacts: {
      email: { present: true, masked: 'a•••@example.test', verified: false },
      phone: { present: true, masked: '+23480•••4471', verified: true },
    },
  },
);

// F-084: the "Finish verifying" card on Home and Shop.
describe('Finish verifying', () => {
  it('names the step a phone-first account still owes and opens VF1 at it', async () => {
    answerWith(api.call, { 'GET /me': phoneFirst, 'GET /verification/status': status() });
    const { container } = renderWithApi(api.call, <VerificationChecklist side="SELLER" />);
    const card = await screen.findByRole('region', { name: 'Finish verifying' });
    const email = within(card).getByRole('link', { name: /Confirm your email/ });
    expect(email.getAttribute('href')).toBe('/account/verification#contact');
    expect(email.textContent).toContain('You signed up with your phone.');
    expect(within(email).getByText('Required')).toBeTruthy();
    const id = within(card).getByRole('link', { name: /Verify your ID/ });
    expect(id.getAttribute('href')).toBe('/account/verification#identity');
    expect(within(id).getByText('Required')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Not now' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('marks ID recommended on Buy, and Not now hides it on this device', async () => {
    answerWith(api.call, {
      'GET /me': me({}, { verificationLevel: 'CONTACT_VERIFIED' }),
      'GET /verification/status': status(),
    });
    renderWithApi(api.call, <VerificationChecklist side="BUYER" />);
    const card = await screen.findByRole('region', { name: 'Finish verifying' });
    expect(within(card).getByText('Recommended')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Finish verifying' })).toBeNull();
    expect(window.localStorage.getItem('komtru.verify.identity.not-now')).toBe('1');
  });

  it('keeps a required step after Not now was used on Buy', async () => {
    window.localStorage.setItem('komtru.verify.identity.not-now', '1');
    answerWith(api.call, { 'GET /me': phoneFirst, 'GET /verification/status': status() });
    renderWithApi(api.call, <VerificationChecklist side="BUYER" />);
    const card = await screen.findByRole('region', { name: 'Finish verifying' });
    expect(within(card).getByRole('link', { name: /Confirm your email/ })).toBeTruthy();
    expect(within(card).queryByRole('link', { name: /Verify your ID/ })).toBeNull();
  });

  it('says an ID check in review is in review', async () => {
    answerWith(api.call, {
      'GET /me': me({}, { verificationLevel: 'CONTACT_VERIFIED' }),
      'GET /verification/status': status({
        inFlight: [
          {
            requestId: '00000000-0000-4000-8000-000000000002',
            type: 'NIN',
            status: 'PENDING',
            submittedAt: '2026-11-21T10:00:00.000Z',
            expiresAt: '2026-11-22T10:00:00.000Z',
          },
        ],
      }),
    });
    renderWithApi(api.call, <VerificationChecklist side="SELLER" />);
    const card = await screen.findByRole('region', { name: 'Finish verifying' });
    expect(within(card).getByText('In review')).toBeTruthy();
  });

  it('draws nothing when nothing is owed', async () => {
    answerWith(api.call, {
      'GET /me': me({}, { verificationLevel: 'IDENTITY_VERIFIED' }),
      'GET /verification/status': status({ level: 'IDENTITY_VERIFIED' }),
    });
    const { container } = renderWithApi(api.call, <VerificationChecklist side="SELLER" />);
    await vi.waitFor(() => {
      expect(api.call).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector('section')).toBeNull();
  });

  it('draws nothing when the status cannot be read', async () => {
    api.call.mockImplementation((endpoint) =>
      (endpoint as { path: string }).path === '/me'
        ? Promise.resolve(phoneFirst)
        : Promise.reject(new Error('offline')),
    );
    const { container } = renderWithApi(api.call, <VerificationChecklist side="SELLER" />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('section')).toBeNull();
  });
});
