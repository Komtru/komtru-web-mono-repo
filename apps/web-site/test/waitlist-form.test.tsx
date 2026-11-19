// @vitest-environment jsdom
// The site's one conversion point. What it must never do is say "you're on the list" when nobody is.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaitlistForm } from '../src/home/WaitlistForm';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.test/v1');
  vi.stubEnv('NEXT_PUBLIC_KOMTRU_SITE_URL', 'https://komtru.test');
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const fill = (name: string, contact: string): void => {
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Phone or email'), { target: { value: contact } });
};

const join = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }));
};

describe('WaitlistForm', () => {
  it('sends the signup and confirms, naming the city back', async () => {
    render(<WaitlistForm />);
    fill('Ada', '08012345678');
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Abuja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    join();

    await waitFor(() => expect(screen.getByText('You’re on the list')).toBeTruthy());
    expect(screen.getByText(/when Abuja opens/)).toBeTruthy();

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      name: 'Ada',
      contact: '08012345678',
      intent: 'SELL',
      city: 'Abuja',
    });
  });

  it('asks for a name before sending anything', () => {
    render(<WaitlistForm />);
    fill('', '08012345678');
    join();
    expect(screen.getByRole('alert').textContent).toBe('Please add your name.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for a usable way to reach the person', () => {
    render(<WaitlistForm />);
    fill('Ada', 'nope');
    join();
    expect(screen.getByRole('alert').textContent).toBe('Add a valid phone number or email.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* The whole point of posting to the platform: a signup that did not land must not look like one
     that did, or the person waits for a message that will never come. */
  it('keeps the form and says so when the platform refuses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    render(<WaitlistForm />);
    fill('Ada', 'ada@example.com');
    join();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('You’re on the list')).toBeNull();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
  });

  /*
   * `tick`, not `ring`: Tailwind generates a `ring` utility, and the moment this markup carries a
   * bare `ring` class the confirmation grows a 1px black box around the mark. It did, once.
   */
  it('names the mark so Tailwind’s ring utility cannot claim it', async () => {
    const { container } = render(<WaitlistForm />);
    fill('Ada', 'ada@example.com');
    join();
    await waitFor(() => expect(screen.getByText('You’re on the list')).toBeTruthy());
    expect(container.querySelector('.ok .tick')).toBeTruthy();
    expect(container.querySelector('.ring')).toBeNull();
  });

  it('counts a repeat signup as being on the list', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }));
    render(<WaitlistForm />);
    fill('Ada', 'ada@example.com');
    join();
    await waitFor(() => expect(screen.getByText('You’re on the list')).toBeTruthy());
  });
});
