// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInForm } from '../src/components/SignInForm';
import { expectNoAxeViolations } from './axe';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const totp = { id: '0190b0a0-0000-7000-8000-000000000001', type: 'TOTP', hint: null, isDefault: true };
const sms = { id: '0190b0a0-0000-7000-8000-000000000002', type: 'SMS_OTP', hint: null, isDefault: false };
const challenge = (factors: unknown[] = [totp]) => ({
  mfaRequired: true,
  mfaToken: 'cid.secret',
  expiresAt: 4_000_000_000_000,
  factors,
});

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const enterPassword = async () => {
  type('Email, phone or username', 'amina@komtru.com');
  type('Password', 'correct horse');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByLabelText('6-digit code');
};

describe('SignInForm', () => {
  it('asks for a password first, with no way to reach the console from it', async () => {
    const { container } = render(<SignInForm />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(true);
    await expectNoAxeViolations(container);
  });

  it('moves to the second factor once the password buys a challenge, and forgets the password', async () => {
    fetchMock.mockResolvedValueOnce(json(challenge()));
    const { container } = render(<SignInForm />);
    await enterPassword();
    expect(screen.getByRole('heading', { name: 'Two-step sign-in' })).toBeDefined();
    expect(screen.getByText('Enter the code from your authenticator app.')).toBeDefined();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('goes to the page the person was after once the code is right', async () => {
    fetchMock.mockResolvedValueOnce(json(challenge()));
    fetchMock.mockResolvedValueOnce(
      json({ accessToken: 'at', scope: 'STAFF', expiresIn: 600, expiresAt: 1 }),
    );
    render(<SignInForm next="/disputes" />);
    await enterPassword();
    type('6-digit code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/disputes'));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as unknown).toMatchObject({
      mfaToken: 'cid.secret',
      factorId: totp.id,
      code: '123456',
    });
  });

  it('will not follow a next that leaves the host', async () => {
    fetchMock.mockResolvedValueOnce(json(challenge()));
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'at' }));
    render(<SignInForm next="//evil.com" />);
    await enterPassword();
    type('6-digit code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/queue'));
  });

  it('says how many tries are left on a wrong code and clears the field', async () => {
    fetchMock.mockResolvedValueOnce(json(challenge()));
    fetchMock.mockResolvedValueOnce(json({ code: 'INVALID_CREDENTIALS', attemptsRemaining: 2 }, 401));
    render(<SignInForm />);
    await enterPassword();
    type('6-digit code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That code did not work. 2 attempts left.')).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('6-digit code').value).toBe('');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows one message for a wrong password and stays on the first step', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'INVALID_CREDENTIALS' }, 401));
    render(<SignInForm />);
    type('Email, phone or username', 'amina@komtru.com');
    type('Password', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That sign-in did not match. Check it and try again.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined();
  });

  it('sends a code for an SMS factor and lets the person switch factors', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        challenge([
          { ...sms, isDefault: true },
          { ...totp, isDefault: false },
        ]),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      json({ kind: 'CODE', challengeId: null, maskedDestination: '+23480•••5567', delivered: true }),
    );
    render(<SignInForm />);
    await enterPassword();
    expect(await screen.findByText('We sent a code to +23480•••5567.')).toBeDefined();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/mfa-challenge');
    fireEvent.click(screen.getByRole('button', { name: 'Use authenticator app instead' }));
    expect(await screen.findByText('Enter the code from your authenticator app.')).toBeDefined();
  });

  it('starts over from the second step', async () => {
    fetchMock.mockResolvedValueOnce(json(challenge()));
    render(<SignInForm />);
    await enterPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined();
  });

  it('says so when a different kind of account was turned away', () => {
    render(<SignInForm wrongScope />);
    expect(screen.getByText(/not a team account/)).toBeDefined();
  });
});
