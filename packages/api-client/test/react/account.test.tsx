// @vitest-environment jsdom
// F-045: what the account hooks leave in TanStack's MutationCache once the screen that used them has gone.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import {
  useCloseAccount,
  useConfirmCurrentPhone,
  useConfirmNewPhone,
  useEnrolTotp,
  useRetireDevice,
  useRegenerateRecoveryCodes,
  useStartPhoneChange,
  useStepUp,
  useSubmitNin,
} from '../../src/react/account.js';
import { ApiClientProvider } from '../../src/react/client-context.js';

afterEach(cleanup);

const ID = '0190b0a0-0000-7000-8000-000000000001';

/** Any call answers 200 with a body that is whatever the endpoint would parse; the point is the cache, not the answer. */
const answers: Record<string, unknown> = {
  '/me/close': { status: 'CLOSED', sessionsRevoked: 1 },
  '/me/step-up': { stepUpToken: 'chal.secret', expiresAt: 1 },
  '/me/mfa/totp/enroll': { factorId: ID, secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' },
  '/me/mfa/recovery-codes': { recoveryCodes: ['7K2M-9PQX'] },
  '/me/phone/change': {
    changeId: ID,
    challengeId: ID,
    maskedDestination: '+23480•••4471',
    expiresAt: '2026-11-17T10:00:00.000Z',
    delivered: true,
  },
  '/me/phone/change/confirm-current': {
    challengeId: ID,
    maskedDestination: '+23490•••2290',
    expiresAt: '2026-11-17T10:00:00.000Z',
    delivered: true,
  },
  '/me/phone/change/confirm-new': { status: 'CHANGED', maskedPhone: '+23490•••2290' },
  '/verification/nin': { requestId: ID, status: 'SUBMITTED' },
};

const setup = () => {
  const fetch = vi.fn((input: URL | RequestInfo) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace('/v1', '');
    return Promise.resolve(
      new Response(JSON.stringify(answers[path] ?? {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  const queryClient = new QueryClient();
  const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
};

/** Runs one mutation, then unmounts the screen. What is left in the cache is what a later screen could read. */
async function leftBehind<T extends { mutateAsync: (v: never) => Promise<unknown> }>(
  hook: () => T,
  variables: unknown,
): Promise<unknown[]> {
  const { queryClient, wrapper } = setup();
  const rendered = renderHook(hook, { wrapper });
  await act(async () => {
    await rendered.result.current.mutateAsync(variables as never);
  });
  rendered.unmount();
  // Collected on the next tick with `gcTime: 0`, and not for five minutes otherwise.
  await waitFor(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return queryClient.getMutationCache().getAll();
}

describe('secrets in the mutation cache', () => {
  it.each([
    [
      'the password to close an account',
      () => useCloseAccount(),
      { reason: 'OTHER', password: 'hunter2hunter2' },
    ],
    ['a step-up proof request', () => useStepUp(), { password: 'hunter2hunter2' }],
    ['the TOTP seed', () => useEnrolTotp(), undefined],
    ['the backup codes', () => useRegenerateRecoveryCodes(), 'chal.secret'],
    ['a national ID number', () => useSubmitNin(), { nin: '12345678901', firstName: 'A', lastName: 'B' }],
    [
      'a step-up token and a phone number',
      () => useStartPhoneChange(),
      { newPhone: '0905 118 2290', stepUpToken: 'a.b' },
    ],
    [
      'the code for the current number',
      () => useConfirmCurrentPhone(),
      { changeId: ID, challengeId: ID, code: '123456' },
    ],
    [
      'the code for the new number',
      () => useConfirmNewPhone(),
      { changeId: ID, challengeId: ID, code: '123456' },
    ],
  ] as const)('drops %s when the screen goes', async (_name, hook, variables) => {
    expect(await leftBehind(hook as never, variables)).toEqual([]);
  });
});

describe('the control', () => {
  it('keeps what an ordinary mutation was given, so the test above would notice a leak', async () => {
    answers[`/me/devices/${ID}`] = { ok: true };
    expect(await leftBehind(() => useRetireDevice(), ID)).toHaveLength(1);
  });
});
