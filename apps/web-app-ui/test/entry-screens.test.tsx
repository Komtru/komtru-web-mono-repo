// @vitest-environment jsdom
//
// The entry screens (T-111), each rendered inside the real providers with only the network faked:
// what the person sees, what each tap sends, and where they end up.
import { KomtruProviders, useApiClient } from '@komtru/app-kit/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '../src/entry/components/LoginForm';
import { ResetPasswordForm } from '../src/entry/components/PasswordReset';
import { SignUpForm } from '../src/entry/components/SignUpForm';
import { TermsForm } from '../src/entry/components/TermsForm';
import { TermsUpdated } from '../src/entry/components/TermsScreens';
import { VerifyForm } from '../src/entry/components/VerifyForm';
import { Welcome } from '../src/entry/components/Welcome';
import { clearEntryDrafts, resetCode, signUpCode, signUpDraft } from '../src/entry/drafts';
import { expectNoAxeViolations } from './axe';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const API = 'https://api.komtru.com/v1';
const challengeId = '9b2f4c1e-7a3d-4e5b-8c6f-1d0a2b3c4e5f';

interface Sent {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

/** Answers by `METHOD path`, in order per route, and records every request. */
class Network {
  sent: Sent[] = [];
  private routes = new Map<string, { status: number; body: unknown }[]>();

  on(route: string, status: number, body: unknown): this {
    const queue = this.routes.get(route) ?? [];
    queue.push({ status, body });
    this.routes.set(route, queue);
    return this;
  }

  readonly fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    this.sent.push({
      url,
      method,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      authorization: headers.get('authorization'),
    });
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const queue = this.routes.get(`${method} ${path}`) ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) return Promise.reject(new TypeError(`no route for ${method} ${path}`));
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': next.status >= 400 ? 'application/problem+json' : 'application/json' },
      }),
    );
  });

  to(path: string): Sent[] {
    return this.sent.filter((request) => request.url.endsWith(path));
  }
}

let network: Network;

beforeEach(() => {
  network = new Network();
  vi.stubGlobal('fetch', network.fetch);
  clearEntryDrafts();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** What the access token is after the screen has run, read through the client the screens use. */
const probe: { token: () => string | null } = { token: () => null };
const tokenNow = (): string | null => probe.token();
function TokenProbe(): null {
  const client = useApiClient();
  useEffect(() => {
    probe.token = () => client.tokens?.read().accessToken ?? null;
  }, [client]);
  return null;
}

const show = (screenUnderTest: React.ReactNode) =>
  render(
    <KomtruProviders config={{ apiUrl: API, socketUrl: 'https://api.komtru.com' }} session={null}>
      <TokenProbe />
      {screenUnderTest}
    </KomtruProviders>,
  );

const problem = (status: number, code: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: 'about:blank',
  status,
  code,
  title,
  ...extra,
});

const session = { accessToken: 'at-1', scope: 'CONSUMER', expiresIn: 600, expiresAt: 4_000_000_000_000 };

const typeCode = (code: string) => {
  const cells = screen.getAllByRole('textbox', { name: /Digit \d of 6/ });
  fireEvent.paste(cells[0]!, { clipboardData: { getData: () => code } });
};

describe('E1 Welcome', () => {
  it('offers the two ways in, and nothing else', async () => {
    const { container } = show(<Welcome />);
    expect(screen.getByRole('heading', { level: 1, name: 'Trade with strangers, protected.' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Create account' }).getAttribute('href')).toBe('/signup');
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login');
    await expectNoAxeViolations(container);
  });
});

describe('E2 Sign up', () => {
  it('asks for both fields before going on', () => {
    show(<SignUpForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Enter your phone number/)).toBeDefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps the details for the Terms screen, which opens the account', async () => {
    const { container } = show(<SignUpForm />);
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0802 341 5567' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Obi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signUpDraft.read()).toEqual({ phone: '0802 341 5567', fullName: 'Ada Obi' });
    expect(router.push).toHaveBeenCalledWith('/signup/terms');
    // Nothing is sent from E2: the account and the code both come from TOS1's one call.
    expect(network.sent).toEqual([]);
    await expectNoAxeViolations(container);
  });
});

describe('TOS1 Terms', () => {
  beforeEach(() => {
    signUpDraft.write({ phone: '0802 341 5567', fullName: 'Ada Obi' });
  });

  const agree = () => {
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Agree & create account' }));
  };

  it('starts unticked and waits for both acknowledgements', async () => {
    const { container } = show(<TermsForm />);
    const button = screen.getByRole('button', { name: 'Agree & create account' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(button.hasAttribute('disabled')).toBe(true);
    await expectNoAxeViolations(container);
  });

  it('opens the account with the versions the platform says are in force, then asks for the code', async () => {
    network
      .on('GET /auth/terms', 200, { termsVersion: '2026-09-01', privacyVersion: '2026-08-15' })
      .on('POST /auth/register', 201, {
        userId: '0190b0a0-0000-7000-8000-000000000001',
        publicId: 'u_1',
        status: 'PENDING',
        challengeId,
        nextStep: 'VERIFY_PHONE',
        expiresAt: 4_000_000_000_000,
        maskedDestination: '+23480•••5567',
        delivered: true,
      });
    show(<TermsForm />);
    agree();
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/verify');
    });
    expect(network.to('/auth/register')[0]?.body).toEqual({
      channel: 'PHONE',
      phone: '0802 341 5567',
      fullName: 'Ada Obi',
      acceptedTermsVersion: '2026-09-01',
      acceptedPrivacyVersion: '2026-08-15',
    });
    expect(signUpCode.read()).toMatchObject({ challengeId, destination: '+23480•••5567', delivered: true });
  });

  it('sends a number that already has an account to log in', async () => {
    network
      .on('GET /auth/terms', 200, { termsVersion: '2026-08-01', privacyVersion: '2026-08-01' })
      .on('POST /auth/register', 409, problem(409, 'CONFLICT', 'That contact is already in use'));
    show(<TermsForm />);
    agree();
    expect(await screen.findByText(/already has a Komtru account/)).toBeDefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('starts again at the number when nothing was remembered', () => {
    clearEntryDrafts();
    show(<TermsForm />);
    expect(router.replace).toHaveBeenCalledWith('/signup');
  });
});

describe('E3 and E3b Verify', () => {
  beforeEach(() => {
    signUpCode.write({ challengeId, destination: '+23480•••5567', delivered: true, sentAt: Date.now() });
  });

  it('says where the code went and counts down to a resend', async () => {
    const { container } = show(<VerifyForm />);
    expect(screen.getByText('Sent to +23480•••5567 via SMS.')).toBeDefined();
    expect(screen.getByText(/Resend in 0:/)).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('shows E3b for a wrong code, with the attempts left', async () => {
    network.on(
      'POST /api/auth/verify',
      422,
      problem(422, 'OTP_INVALID', "That code doesn't match", { attemptsRemaining: 2 }),
    );
    const { container } = show(<VerifyForm />);
    typeCode('481902');
    fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
    expect(await screen.findByText(/That code doesn.t match — check the SMS/)).toBeDefined();
    expect(screen.getByText('2 attempts remaining before we ask you to request a fresh code.')).toBeDefined();
    expect(screen.getByRole('group', { name: 'Verification code' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('opens the session through the route handler and goes on to set a password', async () => {
    network.on('POST /api/auth/verify', 200, { ...session, nextStep: 'SET_PASSWORD', user: { id: 'u1' } });
    show(<VerifyForm />);
    typeCode('482390');
    fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/set-password');
    });
    expect(network.to('/api/auth/verify')[0]?.body).toEqual({ challengeId, code: '482390' });
    expect(tokenNow()).toBe('at-1');
    // Finished: nothing about the sign-up stays behind in this tab.
    expect(signUpCode.read()).toBeNull();
  });

  it('asks for a fresh code once the code is spent', async () => {
    network
      .on('POST /api/auth/verify', 422, problem(422, 'OTP_INVALID', 'That code is no longer usable'))
      .on('POST /auth/otp/resend', 200, {
        challengeId: '0190b0a0-0000-7000-8000-000000000009',
        expiresAt: 1,
      });
    show(<VerifyForm />);
    typeCode('481902');
    fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));
    await waitFor(() => {
      expect(signUpCode.read()?.challengeId).toBe('0190b0a0-0000-7000-8000-000000000009');
    });
    expect(network.to('/auth/otp/resend')[0]?.body).toEqual({ challengeId });
  });
});

describe('E4 Log in', () => {
  const logIn = (identifier = '0802 341 5567', password = 'a long passphrase') => {
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: identifier } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  };

  it('signs in through the route handler and goes where the person was going', async () => {
    network.on('POST /api/auth/login', 200, { ...session, nextStep: 'DONE' });
    const { container } = show(<LoginForm next="/trades" notice={undefined} />);
    await expectNoAxeViolations(container);
    logIn();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/trades');
    });
    expect(network.to('/api/auth/login')[0]?.body).toEqual({
      identifier: '0802 341 5567',
      password: 'a long passphrase',
    });
    expect(tokenNow()).toBe('at-1');
  });

  it('interrupts with the updated Terms when the platform says they are owed', async () => {
    network.on('POST /api/auth/login', 200, { ...session, nextStep: 'ACCEPT_TERMS' });
    show(<LoginForm next={undefined} notice={undefined} />);
    logIn();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/terms-updated');
    });
  });

  it('says the same thing for a wrong password and no such account', async () => {
    network.on('POST /api/auth/login', 401, problem(401, 'INVALID_CREDENTIALS', 'Sign in failed'));
    show(<LoginForm next={undefined} notice={undefined} />);
    logIn();
    expect(await screen.findByText(/don.t match an account/)).toBeDefined();
  });

  it('continues to the second factor, asking for the text message once', async () => {
    network
      .on('POST /api/auth/login', 200, {
        mfaRequired: true,
        mfaToken: 'cid.secret',
        expiresAt: 4_000_000_000_000,
        factors: [{ id: 'f1', type: 'SMS_OTP', hint: '•••5567', isDefault: true }],
      })
      .on('POST /api/auth/mfa-challenge', 200, {
        kind: 'CODE',
        maskedDestination: '+23480•••5567',
        delivered: true,
      })
      .on('POST /api/auth/mfa', 200, { ...session, nextStep: 'DONE' });
    const { container } = show(<LoginForm next={undefined} notice={undefined} />);
    logIn();
    expect(await screen.findByText('Sent to +23480•••5567.')).toBeDefined();
    expect(network.to('/api/auth/mfa-challenge')).toHaveLength(1);
    await expectNoAxeViolations(container);
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify & log in' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/');
    });
    expect(network.to('/api/auth/mfa')[0]?.body).toEqual({
      mfaToken: 'cid.secret',
      factorId: 'f1',
      code: '123456',
    });
  });

  it('confirms a finished password reset', () => {
    show(<LoginForm next={undefined} notice="reset-done" />);
    expect(screen.getByText('Your password is updated')).toBeDefined();
  });
});

describe('AC3 Set new password', () => {
  beforeEach(() => {
    resetCode.write({ challengeId, destination: '+23480•••5567', delivered: true, sentAt: Date.now() });
  });

  const fill = (password: string, confirmation = password) => {
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  };

  it('checks the two passwords before spending the code', async () => {
    const { container } = show(<ResetPasswordForm />);
    typeCode('729401');
    fill('a long passphrase', 'a long passphrasf');
    expect(await screen.findByText("The two passwords don't match.")).toBeDefined();
    expect(network.sent).toEqual([]);
    await expectNoAxeViolations(container);
  });

  it('proves the code, then sets the password, then sends the person to log in', async () => {
    network
      .on('POST /api/auth/verify', 200, {
        verified: true,
        nextStep: 'SET_PASSWORD',
        resetToken: 'cid.secret',
        expiresAt: 1,
      })
      .on('POST /auth/password/reset', 200, { ok: true, revokedSessions: 2 });
    show(<ResetPasswordForm />);
    typeCode('729401');
    fill('a long passphrase');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/login?reset=done');
    });
    expect(network.to('/auth/password/reset')[0]?.body).toEqual({
      resetToken: 'cid.secret',
      newPassword: 'a long passphrase',
    });
    expect(resetCode.read()).toBeNull();
  });

  it('keeps the proved code when the platform refuses the password, so a second try costs nothing', async () => {
    network
      .on('POST /api/auth/verify', 200, {
        verified: true,
        nextStep: 'SET_PASSWORD',
        resetToken: 'cid.secret',
        expiresAt: 1,
      })
      .on(
        'POST /auth/password/reset',
        422,
        problem(422, 'VALIDATION_FAILED', 'That password cannot be used', {
          errors: [{ path: 'newPassword', message: 'That password appears in known breaches.' }],
        }),
      );
    show(<ResetPasswordForm />);
    typeCode('729401');
    fill('password1234');
    expect(await screen.findByText('That password appears in known breaches.')).toBeDefined();
    fill('a much better passphrase');
    await waitFor(() => {
      expect(network.to('/auth/password/reset')).toHaveLength(2);
    });
    expect(network.to('/api/auth/verify')).toHaveLength(1);
  });
});

describe('TOS2 Terms updated', () => {
  it('accepts exactly the versions in force, then carries on', async () => {
    network
      .on('POST /api/auth/refresh', 200, session)
      .on('GET /me/terms', 200, {
        termsVersion: '2026-09-01',
        privacyVersion: '2026-09-01',
        acceptedTermsVersion: '2026-08-01',
        acceptedPrivacyVersion: '2026-08-01',
        upToDate: false,
      })
      .on('POST /me/terms/accept', 200, { ok: true });
    const { container } = show(<TermsUpdated next="/trades" />);
    expect(await screen.findByRole('heading', { name: "We've updated our Terms" })).toBeDefined();
    await expectNoAxeViolations(container);
    const agree = screen.getByRole('button', { name: 'Agree & continue' });
    expect(agree.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(agree);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/trades');
    });
    expect(network.to('/me/terms/accept')[0]?.body).toEqual({
      termsVersion: '2026-09-01',
      privacyVersion: '2026-09-01',
    });
  });

  it('does not interrupt someone who already accepted them', async () => {
    network.on('POST /api/auth/refresh', 200, session).on('GET /me/terms', 200, {
      termsVersion: '2026-08-01',
      privacyVersion: '2026-08-01',
      acceptedTermsVersion: '2026-08-01',
      acceptedPrivacyVersion: '2026-08-01',
      upToDate: true,
    });
    show(<TermsUpdated next={undefined} />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/');
    });
  });
});
