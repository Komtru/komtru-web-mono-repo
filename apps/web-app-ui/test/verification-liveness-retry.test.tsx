// @vitest-environment jsdom
// VF1: what a user gets after a liveness check that did not succeed.
//
// Two defects found on staging, both of which left a verified user with no way forward:
//
//  1. Closing the Youverify SDK without finishing left the request at PROVIDER_PENDING. VF1's
//     start branch only renders when nothing is in flight, so the screen showed "We're checking"
//     over a check nobody was performing — for the full 24h TTL, with no control to press.
//  2. When a liveness check did fail, the "Try again" control was the OLD photo-upload form. It
//     bypasses the provider the rest of this flow now uses, so the retry could never produce the
//     webhook the verdict arrives on.
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

const VERIFIED_ID = { identifier: true, liveness: false, business: false, businessBankAccount: false };

const status = (over: Record<string, unknown> = {}) => ({
  level: 'CONTACT_VERIFIED',
  levelNumber: 1,
  levelAttainedAt: null,
  requirements: VERIFIED_ID,
  inFlight: [],
  rejections: [],
  ...over,
});

const livenessFailure = {
  requestId: 'bd6f3a2e-0c71-4a2c-9f1e-5b7d2c4a8e90',
  type: 'LIVENESS',
  decidedAt: '2026-11-19T18:00:00.000Z',
  reason: {
    code: 'LIVENESS_FAILED',
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this usually happens',
    why: 'The selfie did not match the photo on your ID.',
    remedy: 'RESUBMIT',
    identityLevelAffected: true,
  },
};

const show = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  answerWith(api.call, {
    'GET /me': me,
    'GET /verification/status': status(over),
    ...extra,
  });
  return renderWithApi(api.call, <Verification />);
};

describe('VF1 — retrying a liveness check', () => {
  it('offers the camera again after a failed selfie, not a photo upload', async () => {
    show({ rejections: [livenessFailure] });

    expect(await screen.findByRole('button', { name: /selfie check/i })).toBeTruthy();
    // The old path. An upload cannot produce the signed webhook the verdict arrives on.
    expect(screen.queryByRole('button', { name: /resubmit/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('still explains why the previous attempt failed', async () => {
    // Replacing the control must not swallow the reason: a user who is told nothing will send the
    // same selfie again.
    show({ rejections: [livenessFailure] });

    expect(await screen.findByText(/did not match the photo on your ID/i)).toBeTruthy();
  });
});

/**
 * Closing the SDK without finishing.
 *
 * The SDK is a CDN global, so the test installs a stand-in: `loadYouverifySdk` returns
 * `globalThis.YouverifySDK` when one is already there, which is the seam that lets a test drive
 * the callbacks the real modal would fire.
 */
describe('VF1 — closing the selfie check without finishing', () => {
  const PENDING = {
    requestId: '33333333-3333-4333-8333-333333333333',
    type: 'LIVENESS',
    status: 'PROVIDER_PENDING',
    submittedAt: '2026-11-19T10:00:00.000Z',
    expiresAt: '2026-11-20T10:00:00.000Z',
  };

  let callbacks: Record<string, () => void> = {};

  beforeEach(() => {
    callbacks = {};
    (globalThis as Record<string, unknown>).YouverifySDK = {
      liveness: class {
        constructor(config: Record<string, () => void>) {
          callbacks = config;
        }
        initialize() {}
        start() {}
      },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).YouverifySDK;
  });

  const openThenClose = async () => {
    let open = false;
    answerWith(api.call, {
      'GET /me': me,
      'GET /verification/status': () => status({ inFlight: open ? [PENDING] : [] }),
      'POST /verification/liveness/session': () => {
        open = true;
        return { publicMerchantKey: 'pk', sandbox: true, reference: 'ref', requestId: PENDING.requestId };
      },
      // Keyed by the endpoint's TEMPLATE path, which is what the client carries — not the
      // interpolated one.
      'POST /verification/liveness/session/:requestId/abandon': () => {
        open = false;
        return { abandoned: true };
      },
    });
    renderWithApi(api.call, <Verification />);
    (await screen.findByRole('button', { name: /selfie check/i })).click();
    await waitFor(() => expect(callbacks.onClose).toBeTypeOf('function'));
    callbacks.onClose?.();
  };

  it('tells the platform the session is over', async () => {
    await openThenClose();

    await waitFor(() => {
      const paths = api.call.mock.calls.map(([endpoint]) => endpoint.path);
      expect(paths).toContain('/verification/liveness/session/:requestId/abandon');
    });
  });

  it('offers the camera again instead of leaving a spinner nobody can clear', async () => {
    // The staging defect exactly: before this, the screen sat on "We're checking" for 24h.
    await openThenClose();

    expect(await screen.findByRole('button', { name: /selfie check/i })).toBeTruthy();
    expect(screen.queryByText(/we.re checking/i)).toBeNull();
  });
});
