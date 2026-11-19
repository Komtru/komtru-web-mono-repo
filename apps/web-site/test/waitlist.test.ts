import { afterEach, describe, expect, it, vi } from 'vitest';
import { isContact, joinWaitlist, type WaitlistSignup } from '../src/site/waitlist';

afterEach(() => vi.unstubAllEnvs());

const SIGNUP: WaitlistSignup = {
  name: 'Ada',
  contact: 'ada@example.com',
  intent: 'BUY',
  city: 'Lagos',
};

const respondWith = (status: number): typeof fetch =>
  vi.fn().mockResolvedValue(new Response(null, { status }));

describe('isContact', () => {
  it.each(['+2348012345678', '08012345678', '0801 234 5678', '0801-234-5678', 'ada@example.com'])(
    'accepts %s',
    (value) => expect(isContact(value)).toBe(true),
  );

  it.each(['', 'Ada', '12345', 'ada@example', 'ada at example.com'])('rejects %s', (value) =>
    expect(isContact(value)).toBe(false),
  );
});

describe('joinWaitlist', () => {
  it('posts the signup to the platform', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.com/v1');
    const fetchImpl = respondWith(201);

    expect(await joinWaitlist(SIGNUP, fetchImpl)).toEqual({ kind: 'joined' });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.komtru.com/v1/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SIGNUP),
    });
  });

  /* Signing up twice is not an error to the person doing it: either way they are on the list. */
  it('treats a repeat signup as success', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.com/v1');
    expect(await joinWaitlist(SIGNUP, respondWith(409))).toEqual({ kind: 'joined' });
  });

  it('reports a refusal rather than claiming success', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.com/v1');
    const result = await joinWaitlist(SIGNUP, respondWith(500));
    expect(result.kind).toBe('failed');
  });

  it('reports a network failure rather than claiming success', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.com/v1');
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch;
    expect((await joinWaitlist(SIGNUP, fetchImpl)).kind).toBe('failed');
  });

  /*
   * The reference's actual bug, written down: it wrote the signup to localStorage and to a
   * `window.KOMTRU_WAITLIST_URL` hook that nothing ever set, then showed "You're on the list".
   * With no platform to post to, this says so instead — and makes no call.
   */
  it('does not pretend to have joined when there is no platform to join', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', '');
    const fetchImpl = respondWith(201);

    const result = await joinWaitlist(SIGNUP, fetchImpl);

    expect(result.kind).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
