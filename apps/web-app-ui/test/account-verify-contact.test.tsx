// @vitest-environment jsdom
// F-081 on VF1: a badge per contact channel, and a way to prove whichever is not done.
import { ProblemError, type ContactChannelState } from '@komtru/api-client';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactChecks } from '../src/account/VerifyContact';

const verified: ContactChannelState = { present: true, masked: 'a•••@x.test', verified: true };
const unverified: ContactChannelState = { present: true, masked: 'a•••@x.test', verified: false };
const absent: ContactChannelState = { present: false, masked: null, verified: false };

const start = vi.fn();
const confirm = vi.fn();

beforeEach(() => {
  start.mockReset();
  confirm.mockReset();
  start.mockResolvedValue({
    challengeId: 'c1',
    maskedDestination: 'a•••@x.test',
    expiresAt: '2026-11-18T18:00:00.000Z',
    delivered: true,
  });
  confirm.mockResolvedValue({
    status: 'VERIFIED',
    verificationLevel: 'CONTACT_VERIFIED',
    maskedDestination: 'a•••@x.test',
  });
});

vi.mock('@komtru/api-client/react', () => ({
  useStartContactVerification: () => ({
    mutate: start,
    mutateAsync: start,
    isPending: false,
    reset: vi.fn(),
  }),
  useConfirmContactVerification: () => ({
    mutate: confirm,
    mutateAsync: confirm,
    isPending: false,
    reset: vi.fn(),
  }),
}));

const row = (name: RegExp) => screen.getByRole('group', { name });

/** A real `ProblemError`, so the component is tested against the error it will actually catch. */
const problem = (code: string, status: number) =>
  new ProblemError(
    { type: 'about:blank', title: code, status, code },
    { status, requestId: 'r1', retryAfterMs: undefined, rateLimit: undefined, replayed: false },
    false,
  );

afterEach(cleanup);

describe('ContactChecks (F-081)', () => {
  it('badges a verified channel and offers no action on it', () => {
    render(<ContactChecks contacts={{ email: verified, phone: verified }} />);

    expect(within(row(/email/i)).getByText('Verified')).toBeTruthy();
    expect(within(row(/email/i)).queryByRole('button')).toBeNull();
  });

  it('badges an unverified channel and offers to verify it', () => {
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    expect(within(row(/email/i)).getByText('Not verified')).toBeTruthy();
    expect(within(row(/email/i)).getByRole<HTMLButtonElement>('button', { name: /verify/i }).disabled).toBe(
      false,
    );
  });

  it('shows the masked address, never a bare one', () => {
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    expect(within(row(/email/i)).getByText('a•••@x.test')).toBeTruthy();
  });

  it('asks for an address first when the account has none', () => {
    render(<ContactChecks contacts={{ email: absent, phone: verified }} />);

    expect(within(row(/email/i)).getByRole('button', { name: /add/i })).toBeTruthy();
    // By placeholder, not label: the row's own aria-label is also "Email address".
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy();
  });

  it('lets a present-but-unverified channel correct its address', () => {
    // The typo case the design names: a phone-first signup whose registration email was mistyped.
    // Without an editable field the code goes to the wrong address forever.
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    expect(within(row(/email/i)).getByPlaceholderText('you@example.com')).toBeTruthy();
  });

  it('tells the person when no code was sent, rather than claiming one was', async () => {
    start.mockResolvedValueOnce({
      challengeId: 'c1',
      maskedDestination: 'a•••@x.test',
      expiresAt: '2026-11-18T18:00:00.000Z',
      delivered: false,
    });
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    fireEvent.click(within(row(/email/i)).getByRole('button', { name: /verify/i }));

    expect(await screen.findByText(/couldn’t send another code/i)).toBeTruthy();
    expect(screen.queryByText(/we sent a code/i)).toBeNull();
  });

  it('shows the code field once a code is on its way', async () => {
    start.mockResolvedValueOnce({
      challengeId: 'c1',
      maskedDestination: 'a•••@x.test',
      expiresAt: '2026-11-18T18:00:00.000Z',
      delivered: true,
    });
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    fireEvent.click(within(row(/email/i)).getByRole('button', { name: /verify/i }));

    expect(await screen.findByLabelText(/enter the code/i)).toBeTruthy();
    expect(screen.getByText(/we sent a code to a•••@x.test/i)).toBeTruthy();
  });

  it('says the address belongs to someone else, not that the send failed', async () => {
    start.mockRejectedValueOnce(problem('CONTACT_TAKEN', 409));
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    fireEvent.click(within(row(/email/i)).getByRole('button', { name: /verify/i }));

    expect(await screen.findByText(/belongs to another account/i)).toBeTruthy();
  });

  it('tells the person to ask for a new code when the old one has lapsed', async () => {
    start.mockResolvedValueOnce({
      challengeId: 'c1',
      maskedDestination: 'a•••@x.test',
      expiresAt: '2026-11-18T18:00:00.000Z',
      delivered: true,
    });
    confirm.mockRejectedValueOnce(problem('OTP_INVALID', 422));
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);
    fireEvent.click(within(row(/email/i)).getByRole('button', { name: /verify/i }));

    const field = await screen.findByLabelText(/enter the code/i);
    fireEvent.change(field, { target: { value: '123456' } });
    fireEvent.click(within(row(/email/i)).getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/didn’t match/i)).toBeTruthy();
  });

  it('sends a code for a channel that already has an address', () => {
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    fireEvent.click(within(row(/email/i)).getByRole('button', { name: /verify/i }));

    expect(start).toHaveBeenCalled();
  });
});
