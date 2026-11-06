// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeFlow } from '../src/components/WelcomeFlow';
import { expectNoAxeViolations } from './axe';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = 't'.repeat(40);

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

let calls: Call[];
let routes: Record<string, () => Response>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_KOMTRU_APP_URL', 'https://ops.komtru.com');
  vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.com/v1');
  calls = [];
  routes = {
    '/api/invitation/sign-in': () => json({ accessToken: 'consumer-at', expiresAt: 4_000_000_000_000 }),
    '/api/invitation/release': () => json({ ok: true }),
    'POST /v1/me/staff-invitations/start': () =>
      json({ challengeId: id(1), expiresAt: '2026-11-07T10:00:00.000Z' }),
    'POST /v1/me/staff-invitations/accept': () =>
      json({ status: 'GRANTED', roleCode: 'KYC_ANALYST', assignmentId: id(2) }),
    'POST /v1/me/mfa/totp/enroll': () =>
      json({
        factorId: id(3),
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/Komtru?secret=JBSWY3DP',
      }),
    'POST /v1/me/mfa/totp/activate': () =>
      json({ factorId: id(3), recoveryCodes: ['aaaa-1111', 'bbbb-2222'] }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        'https://ops.komtru.com',
      );
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      calls.push({
        url: url.pathname,
        method,
        auth: headers.get('authorization'),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      const route = routes[`${method} ${url.pathname}`] ?? routes[url.pathname];
      return Promise.resolve(route === undefined ? json({ title: 'Not found' }, 404) : route());
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const flow = async (fragment: string | null = `#token=${TOKEN}`) => {
  window.history.replaceState(null, '', `/welcome${fragment ?? ''}`);
  const view = render(<WelcomeFlow />);
  // The token is read in an effect; the first paint says nothing about it.
  await waitFor(() =>
    expect(
      screen.queryByLabelText('Password') ?? screen.queryByText('Open the link in your invitation email'),
    ).not.toBeNull(),
  );
  return view;
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const signInAndAccept = async () => {
  type('Email, phone or username', 'amina@komtru.com');
  type('Password', 'correct horse');
  fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
  await screen.findByLabelText('6-digit code');
  type('6-digit code', '123456');
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByRole('heading', { name: 'Secure your account' });
};

describe('WelcomeFlow', () => {
  it('draws the six steps with the first active, and the rest dimmed', async () => {
    const { container } = await flow();
    const steps = within(screen.getByRole('list', { name: 'Your first day' })).getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    expect(steps[0]?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Step 1 of 6 · takes about 3 minutes.')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('asks for the invitation link when there is no token', async () => {
    await flow(null);
    expect(screen.getByText('Open the link in your invitation email')).toBeDefined();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('signs in, sends the code, accepts, and lands on securing the account', async () => {
    const { container } = await flow();
    await signInAndAccept();

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/invitation/sign-in',
      'POST /v1/me/staff-invitations/start',
      'POST /v1/me/staff-invitations/accept',
      'POST /v1/me/mfa/totp/enroll',
    ]);
    // The consumer token rides on the platform calls, and the token and code are what is sent.
    expect(calls[1]).toMatchObject({ auth: 'Bearer consumer-at', body: { token: TOKEN } });
    expect(calls[2]?.body).toEqual({ token: TOKEN, challengeId: id(1), code: '123456' });

    expect(screen.getByText('Step 2 of 6 · takes about 3 minutes.')).toBeDefined();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('turns on two-step sign-in, shows the recovery codes once, then points at sign-in', async () => {
    await flow();
    await signInAndAccept();
    type('Enter the 6-digit code', '654321');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));
    await screen.findByRole('heading', { name: 'Save your recovery codes' });
    expect(screen.getByText('aaaa-1111')).toBeDefined();
    expect(calls.find((call) => call.url === '/v1/me/mfa/totp/activate')?.body).toEqual({
      factorId: id(3),
      code: '654321',
    });

    fireEvent.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(await screen.findByText('Two-step sign-in is on')).toBeDefined();
    expect(screen.queryByText('aaaa-1111')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to sign-in' }).getAttribute('href')).toBe('/sign-in');
  });

  it('says so when the role needs a second approver', async () => {
    routes['POST /v1/me/staff-invitations/accept'] = () =>
      json({ status: 'PENDING_APPROVAL', roleCode: 'SUPER_ADMIN', approvalId: id(9) });
    await flow();
    await signInAndAccept();
    expect(screen.getByText('A second person has to approve your role')).toBeDefined();
  });

  it('stays on the code step with the platform’s words when the code is wrong', async () => {
    routes['POST /v1/me/staff-invitations/accept'] = () =>
      json(
        {
          type: 'about:blank',
          status: 422,
          code: 'OTP_INVALID',
          title: "That code doesn't match",
          detail: 'Check the message and try again',
          attemptsRemaining: 3,
        },
        422,
      );
    await flow();
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await screen.findByLabelText('6-digit code');
    type('6-digit code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText("That code doesn't match. Check the message and try again")).toBeDefined();
    expect(screen.getByLabelText('6-digit code')).toBeDefined();
  });

  it('reads the token from the fragment and takes it out of the address bar', async () => {
    await flow();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/welcome');
    // And the token is in the body of the sign-in, never in a URL.
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await screen.findByLabelText('6-digit code');
    expect(calls[0]).toMatchObject({
      url: '/api/invitation/sign-in',
      body: { identifier: 'amina@komtru.com', password: 'pw', invitationToken: TOKEN },
    });
  });

  it('asks for the invitation link when the old query form is all there is', async () => {
    window.history.replaceState(null, '', `/welcome?token=${TOKEN}`);
    render(<WelcomeFlow />);
    expect(await screen.findByText('Open the link in your invitation email')).toBeDefined();
  });

  it('asks for the second factor a consumer account already has, instead of dead-ending', async () => {
    const totp = { id: id(7), type: 'TOTP', hint: null, isDefault: true };
    routes['/api/invitation/sign-in'] = () =>
      json({ mfaRequired: true, mfaToken: 'cid.secret', expiresAt: 4_000_000_000_000, factors: [totp] });
    routes['/api/invitation/mfa'] = () =>
      json({ accessToken: 'consumer-at', scope: 'CONSUMER', expiresIn: 600, expiresAt: 4_000_000_000_000 });
    await flow();
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByText(/already uses two-step sign-in/)).toBeDefined();
    expect(screen.queryByText(/turn it off/i)).toBeNull();

    type('6-digit code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Enter the code we sent');
    expect(calls.map((call) => call.url)).toEqual([
      '/api/invitation/sign-in',
      '/api/invitation/mfa',
      '/v1/me/staff-invitations/start',
    ]);
    expect(calls[1]?.body).toEqual({ mfaToken: 'cid.secret', factorId: totp.id, code: '123456' });
    expect(calls[2]?.auth).toBe('Bearer consumer-at');
  });

  it('sends the code for a texted factor and lets the person switch', async () => {
    const sms = { id: id(8), type: 'SMS_OTP', hint: null, isDefault: true };
    const totp = { id: id(7), type: 'TOTP', hint: null, isDefault: false };
    routes['/api/invitation/sign-in'] = () =>
      json({ mfaRequired: true, mfaToken: 'cid.secret', expiresAt: 4_000_000_000_000, factors: [sms, totp] });
    routes['/api/invitation/mfa-challenge'] = () =>
      json({ kind: 'CODE', challengeId: null, maskedDestination: '+23480•••5567', delivered: true });
    await flow();
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByText('We sent a code to +23480•••5567.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Use authenticator app instead' }));
    expect(await screen.findByText(/authenticator app/)).toBeDefined();
  });

  it('keeps a wrong second-factor code on its step, with the tries left', async () => {
    const totp = { id: id(7), type: 'TOTP', hint: null, isDefault: true };
    routes['/api/invitation/sign-in'] = () =>
      json({ mfaRequired: true, mfaToken: 'cid.secret', expiresAt: 4_000_000_000_000, factors: [totp] });
    routes['/api/invitation/mfa'] = () => json({ code: 'INVALID_CREDENTIALS', attemptsRemaining: 2 }, 401);
    await flow();
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await screen.findByText(/already uses two-step sign-in/);
    type('6-digit code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That code did not work. 2 attempts left.')).toBeDefined();
  });

  it('releases the consumer session once two-step sign-in is on, and not before', async () => {
    await flow();
    await signInAndAccept();
    expect(calls.some((call) => call.url === '/api/invitation/release')).toBe(false);
    type('Enter the 6-digit code', '654321');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));
    await screen.findByRole('heading', { name: 'Save your recovery codes' });
    const release = calls.find((call) => call.url === '/api/invitation/release');
    expect(release).toMatchObject({ method: 'POST', auth: 'Bearer consumer-at' });
  });

  it('releases it when the invitation fails for good, and starts over', async () => {
    routes['POST /v1/me/staff-invitations/accept'] = () =>
      json(
        {
          type: 'about:blank',
          status: 422,
          code: 'OTP_INVALID',
          title: 'That code is no longer usable',
          detail: 'Request a new code and try again',
        },
        422,
      );
    await flow();
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await screen.findByLabelText('6-digit code');
    type('6-digit code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText(/no longer usable/)).toBeDefined();
    await waitFor(() => expect(calls.some((call) => call.url === '/api/invitation/release')).toBe(true));
    expect(screen.getByLabelText('Password')).toBeDefined();
  });

  it('keeps the session through a wrong code with tries left', async () => {
    routes['POST /v1/me/staff-invitations/accept'] = () =>
      json(
        {
          type: 'about:blank',
          status: 422,
          code: 'OTP_INVALID',
          title: "That code doesn't match",
          detail: 'Check the message and try again',
          attemptsRemaining: 3,
        },
        422,
      );
    await flow();
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await screen.findByLabelText('6-digit code');
    type('6-digit code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await screen.findByText(/doesn't match/);
    expect(calls.some((call) => call.url === '/api/invitation/release')).toBe(false);
  });
});
