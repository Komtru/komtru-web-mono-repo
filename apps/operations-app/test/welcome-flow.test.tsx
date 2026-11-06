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
    const { container } = render(<WelcomeFlow token={TOKEN} />);
    const steps = within(screen.getByRole('list', { name: 'Your first day' })).getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    expect(steps[0]?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Step 1 of 6 · takes about 3 minutes.')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('asks for the invitation link when there is no token', () => {
    render(<WelcomeFlow token={undefined} />);
    expect(screen.getByText('Open the link in your invitation email')).toBeDefined();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('signs in, sends the code, accepts, and lands on securing the account', async () => {
    const { container } = render(<WelcomeFlow token={TOKEN} />);
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
    render(<WelcomeFlow token={TOKEN} />);
    await signInAndAccept();
    type('Enter the 6-digit code', '654321');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));
    await screen.findByRole('heading', { name: 'Save your recovery codes' });
    expect(screen.getByText('aaaa-1111')).toBeDefined();
    expect(calls.at(-1)?.body).toEqual({ factorId: id(3), code: '654321' });

    fireEvent.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(await screen.findByText('Two-step sign-in is on')).toBeDefined();
    expect(screen.queryByText('aaaa-1111')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to sign-in' }).getAttribute('href')).toBe('/sign-in');
  });

  it('says so when the role needs a second approver', async () => {
    routes['POST /v1/me/staff-invitations/accept'] = () =>
      json({ status: 'PENDING_APPROVAL', roleCode: 'SUPER_ADMIN', approvalId: id(9) });
    render(<WelcomeFlow token={TOKEN} />);
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
        },
        422,
      );
    render(<WelcomeFlow token={TOKEN} />);
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await screen.findByLabelText('6-digit code');
    type('6-digit code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText("That code doesn't match. Check the message and try again")).toBeDefined();
    expect(screen.getByLabelText('6-digit code')).toBeDefined();
  });

  it('explains a consumer account that has two-step sign-in on', async () => {
    routes['/api/invitation/sign-in'] = () =>
      json(
        {
          code: 'MFA_NOT_SUPPORTED',
          title: 'This account has two-step sign-in on',
          detail: 'Turn it off in the consumer app for now',
        },
        409,
      );
    render(<WelcomeFlow token={TOKEN} />);
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await waitFor(() => expect(screen.getByText(/two-step sign-in on/)).toBeDefined());
    expect(calls).toHaveLength(1);
  });
});
