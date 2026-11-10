// @vitest-environment jsdom
// F-024: the Paystack Inline port. What it opens with, what each Inline callback becomes, and that a failed load
// can be tried again rather than remembered for good.
import type { PaystackInline } from '@komtru/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setup: PaystackInline = {
  key: 'pk_test_x',
  email: 'ada@example.com',
  amount: 45878000,
  currency: 'NGN',
  reference: 'fund-0190b0a0-0000-7000-8000-000000000007',
  channels: ['bank_transfer'],
};

type Options = Record<string, unknown> & { onSuccess: () => void; onCancel: () => void; onError: () => void };
const fresh = async () => {
  vi.resetModules();
  return import('../src/trade/funding/checkout');
};
const scripts = () => [...document.head.querySelectorAll('script[src*="paystack"]')];
const setPop = (value: unknown) => {
  (window as unknown as { PaystackPop?: unknown }).PaystackPop = value;
};

beforeEach(() => {
  document.head.innerHTML = '';
  setPop(undefined);
});
afterEach(() => {
  setPop(undefined);
});

describe('channelsFor', () => {
  it('opens only the chosen method’s channels out of those offered', async () => {
    const { channelsFor } = await fresh();
    expect(channelsFor('transfer', ['card', 'ussd', 'bank_transfer'])).toEqual(['bank_transfer']);
    expect(channelsFor('card', ['card', 'ussd', 'bank_transfer'])).toEqual(['card', 'ussd']);
    expect(channelsFor('card', ['ussd', 'bank_transfer'])).toEqual(['ussd']);
  });

  it('falls back to what the platform offered when none of the method’s channels is there, never adding one', async () => {
    const { channelsFor } = await fresh();
    expect(channelsFor('transfer', ['card'])).toEqual(['card']);
    expect(channelsFor('card', [])).toEqual([]);
  });
});

describe('paystackCheckout', () => {
  it('hands Inline the platform’s setup as given, and maps its three callbacks', async () => {
    const seen: Options[] = [];
    setPop(
      class {
        newTransaction(options: Options) {
          seen.push(options);
        }
      },
    );
    const { paystackCheckout } = await fresh();
    const handlers = { onSuccess: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    await paystackCheckout.open(setup, handlers);
    expect(seen[0]).toMatchObject(setup);
    seen[0]?.onSuccess();
    seen[0]?.onCancel();
    seen[0]?.onError();
    expect(handlers.onSuccess).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
    expect(handlers.onError).toHaveBeenCalledOnce();
  });

  it('loads Inline once, and tries again after a load that left no PaystackPop behind', async () => {
    const { paystackCheckout } = await fresh();
    const handlers = { onSuccess: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    const first = paystackCheckout.open(setup, handlers);
    expect(scripts()).toHaveLength(1);
    scripts()[0]?.dispatchEvent(new Event('load'));
    await expect(first).rejects.toThrow(/did not load/);

    const second = paystackCheckout.open(setup, handlers);
    expect(scripts()).toHaveLength(2);
    const newTransaction = vi.fn();
    setPop(
      class {
        newTransaction = newTransaction;
      },
    );
    scripts()[1]?.dispatchEvent(new Event('load'));
    await second;
    expect(newTransaction).toHaveBeenCalledOnce();
  });

  it('tries again after a script that failed to load', async () => {
    const { paystackCheckout } = await fresh();
    const handlers = { onSuccess: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    const first = paystackCheckout.open(setup, handlers);
    scripts()[0]?.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow();
    void paystackCheckout.open(setup, handlers).catch(() => undefined);
    expect(scripts()).toHaveLength(2);
  });
});
