// @vitest-environment jsdom
// VF1 (F-045): starting a verification.
//
// Until now this screen could only ever show a FAILURE. Its submission forms render inside the
// rejection branch, so a user who had never verified saw an empty state reading "Nothing to fix"
// and had no control to press — the feature was unreachable in the product while both of its
// backend tickets were marked Done. These tests pin the three states a first-time user walks.
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Verification } from '../src/account/Verification';
import { renderWithApi, type CallFn } from './support/workspace';
import { answerWith } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => void api.call.mockReset());

const me = {
  account: { supportReference: 'KMT-SUP-1' },
  contacts: {
    email: { value: 'a@b.test', verified: true },
    phone: { value: '+2348000000000', verified: true },
  },
};

const status = (over: Record<string, unknown> = {}) => ({
  level: 'CONTACT_VERIFIED',
  levelNumber: 1,
  levelAttainedAt: null,
  requirements: { identifier: false, liveness: false, business: false, businessBankAccount: false },
  inFlight: [],
  rejections: [],
  ...over,
});

const show = (over: Record<string, unknown> = {}) => {
  answerWith(api.call, { 'GET /me': me, 'GET /verification/status': status(over) });
  return renderWithApi(api.call, <Verification />);
};

describe('VF1 — starting a verification', () => {
  it('offers a way to verify an ID when none is verified yet', async () => {
    show();
    // The defect this replaces: the screen said "Nothing to fix" and offered no control at all.
    expect(await screen.findByRole('button', { name: /verify your id/i })).toBeTruthy();
    expect(screen.queryByText(/nothing to fix/i)).toBeNull();
  });

  it('offers the selfie check once an ID is verified and liveness is not', async () => {
    show({
      requirements: { identifier: true, liveness: false, business: false, businessBankAccount: false },
    });
    expect(await screen.findByRole('button', { name: /selfie check/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verify your id/i })).toBeNull();
  });

  it('does not offer the selfie check before an ID is verified, which the backend refuses anyway', async () => {
    show();
    await screen.findByRole('button', { name: /verify your id/i });
    expect(screen.queryByRole('button', { name: /selfie check/i })).toBeNull();
  });

  it('says so, and offers nothing, once both are done', async () => {
    show({ requirements: { identifier: true, liveness: true, business: false, businessBankAccount: false } });
    expect(await screen.findByText(/you.re verified/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verify your id|selfie check/i })).toBeNull();
  });

  it('shows the in-flight note instead of a start control while a check is running', async () => {
    show({
      inFlight: [
        {
          requestId: '11111111-1111-4111-8111-111111111111',
          type: 'LIVENESS',
          status: 'PROVIDER_PENDING',
          submittedAt: '2026-11-19T10:00:00.000Z',
          expiresAt: '2026-11-19T11:00:00.000Z',
        },
      ],
      requirements: { identifier: true, liveness: false, business: false, businessBankAccount: false },
    });
    expect(await screen.findByText(/we.re checking/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /selfie check/i })).toBeNull();
  });

  it('never calls the session endpoint just by rendering — it is billable and holds a slot', async () => {
    show({
      requirements: { identifier: true, liveness: false, business: false, businessBankAccount: false },
    });
    await screen.findByRole('button', { name: /selfie check/i });
    await waitFor(() => expect(api.call).toHaveBeenCalled());
    const paths = api.call.mock.calls.map(([endpoint]) => endpoint.path);
    expect(paths).not.toContain('/verification/liveness/session');
  });
});
