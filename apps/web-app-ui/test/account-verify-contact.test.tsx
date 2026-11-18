// @vitest-environment jsdom
// F-081 on VF1: a badge per contact channel, and a way to prove whichever is not done.
import type { ContactChannelState } from '@komtru/api-client';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactChecks } from '../src/account/VerifyContact';

const verified: ContactChannelState = { present: true, masked: 'a•••@x.test', verified: true };
const unverified: ContactChannelState = { present: true, masked: 'a•••@x.test', verified: false };
const absent: ContactChannelState = { present: false, masked: null, verified: false };

const start = vi.fn();
const confirm = vi.fn();

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

  it('sends a code for a channel that already has an address', () => {
    render(<ContactChecks contacts={{ email: unverified, phone: verified }} />);

    fireEvent.click(within(row(/email/i)).getByRole('button', { name: /verify/i }));

    expect(start).toHaveBeenCalled();
  });
});
