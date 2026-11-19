// @vitest-environment jsdom
//
// A visitor who came for a Trade Code: the code travels as `next` through the gate, log in, and sign up, and the
// person ends where the lookup is. The lookup itself needs a session (see `docs/ui-review/T-207/DX-01.md`).
import { KomtruProviders } from '@komtru/app-kit/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../app/(entry)/login/page';
import SignUpPage from '../app/(entry)/signup/page';
import { LoginForm } from '../src/entry/components/LoginForm';
import { SignUpForm } from '../src/entry/components/SignUpForm';
import { VerifyForm } from '../src/entry/components/VerifyForm';
import { clearEntryDrafts, signUpCode, signUpDraft } from '../src/entry/drafts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const API = 'https://api.komtru.com/v1';
const FIND = '/find?code=KMT-482731-NG';
const session = { accessToken: 'at-1', scope: 'CONSUMER', expiresIn: 600, expiresAt: 4_000_000_000_000 };

const answer = (routes: Record<string, unknown>) =>
  vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url.startsWith(API) ? url.slice(API.length) : url}`;
    if (!(key in routes)) return Promise.reject(new TypeError(`no route for ${key}`));
    return Promise.resolve(
      new Response(JSON.stringify(routes[key]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

const show = (node: React.ReactNode) =>
  render(
    <KomtruProviders config={{ apiUrl: API, socketUrl: 'https://api.komtru.com' }} session={null}>
      {node}
    </KomtruProviders>,
  );

beforeEach(() => {
  clearEntryDrafts();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the gate', () => {
  const SECRET = 'test-secret-that-is-long-enough-32';
  let middleware: (request: NextRequest) => Promise<{ status: number; headers: Headers }>;

  beforeAll(async () => {
    Object.assign(process.env, {
      NEXT_PUBLIC_KOMTRU_APP_URL: 'https://app.komtru.com',
      NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
      NEXT_PUBLIC_KOMTRU_PASSPORT_URL: 'https://passport.komtru.com',
      NEXT_PUBLIC_KOMTRU_PARK_URL: 'https://park.komtru.com',
      KOMTRU_SESSION_SECRET: SECRET,
    });
    middleware = (await import('../middleware.js')).default;
  });

  it('sends a logged-out visitor from /find?code to log in, keeping the whole query in next', async () => {
    const { NextRequest: Req } = await import('next/server');
    const response = await middleware(
      new Req(new URL('/find?code=KMT-482731-NG', 'http://localhost:3001'), {
        headers: new Headers({ host: 'app.komtru.com' }),
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `https://app.komtru.com/login?next=${encodeURIComponent(FIND)}`,
    );
  });
});

describe('log in', () => {
  it('reads next through safeNext on the page', async () => {
    const element = await LoginPage({ searchParams: Promise.resolve({ next: FIND }) });
    expect((element.props as { next: string }).next).toBe(FIND);
    const refused = await LoginPage({ searchParams: Promise.resolve({ next: 'https://evil.example/x' }) });
    expect((refused.props as { next?: string }).next).toBeUndefined();
  });

  it('ends at the lookup after a successful log in', async () => {
    vi.stubGlobal(
      'fetch',
      answer({ 'POST /api/auth/login': { ...session, nextStep: 'DONE', user: { id: 'u1' } } }),
    );
    show(<LoginForm next={FIND} notice={undefined} />);
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0802 341 5567' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(FIND);
    });
  });

  it('carries next to sign up, so Create account does not forget the code', () => {
    show(<LoginForm next={FIND} notice={undefined} />);
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      `/signup?next=${encodeURIComponent(FIND)}`,
    );
  });

  it('leaves sign up plain when there is no next', () => {
    show(<LoginForm next={undefined} notice={undefined} />);
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signup');
  });
});

describe('sign up', () => {
  it('reads next through safeNext on the page', async () => {
    const element = await SignUpPage({ searchParams: Promise.resolve({ next: FIND }) });
    expect((element.props as { next: string }).next).toBe(FIND);
    const refused = await SignUpPage({ searchParams: Promise.resolve({ next: '//evil.example' }) });
    expect((refused.props as { next?: string }).next).toBeUndefined();
  });

  it('keeps next in the draft, and the verified account opens its session toward it', async () => {
    show(<SignUpForm next={FIND} />);
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0802 341 5567' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Obi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signUpDraft.read()).toEqual({
      phone: '0802 341 5567',
      email: 'ada@example.com',
      fullName: 'Ada Obi',
      next: FIND,
    });
    cleanup();

    signUpCode.write({
      challengeId: '9b2f4c1e-7a3d-4e5b-8c6f-1d0a2b3c4e5f',
      destination: '+23480•••5567',
      delivered: true,
      sentAt: Date.now(),
    });
    vi.stubGlobal(
      'fetch',
      answer({ 'POST /api/auth/verify': { ...session, nextStep: 'DONE', user: { id: 'u1' } } }),
    );
    show(<VerifyForm />);
    const cells = screen.getAllByRole('textbox', { name: /Digit \d of 6/ });
    fireEvent.paste(cells[0]!, { clipboardData: { getData: () => '729401' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(FIND);
    });
  });

  it('still goes to the first-time walkthrough when the visitor came with nothing to return to', async () => {
    signUpDraft.write({ phone: '0802 341 5567', email: 'ada@example.com', fullName: 'Ada Obi' });
    signUpCode.write({
      challengeId: '9b2f4c1e-7a3d-4e5b-8c6f-1d0a2b3c4e5f',
      destination: '+23480•••5567',
      delivered: true,
      sentAt: Date.now(),
    });
    vi.stubGlobal(
      'fetch',
      answer({ 'POST /api/auth/verify': { ...session, nextStep: 'DONE', user: { id: 'u1' } } }),
    );
    show(<VerifyForm />);
    const cells = screen.getAllByRole('textbox', { name: /Digit \d of 6/ });
    fireEvent.paste(cells[0]!, { clipboardData: { getData: () => '729401' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/welcome');
    });
  });
});
