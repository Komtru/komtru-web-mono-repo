// The checkout the buyer pays in. Paystack Inline runs in the browser against the reference the platform issued
// (design §4.4): the app hands it the platform's `inline` object as given, and never believes its callback —
// "success" only asks the platform to verify (`POST …/payment/confirm`). A port, so the screens are tested with
// a fake and no script is loaded outside a browser.
import type { PaystackInline } from '@komtru/api-client';

export interface CheckoutHandlers {
  /** Paystack says the payment went through. Only a cue to ask the platform. */
  onSuccess: () => void;
  /** The buyer closed the checkout, or it failed to start. A transfer may still be on its way. */
  onClose: () => void;
}

export interface Checkout {
  open: (setup: PaystackInline, handlers: CheckoutHandlers) => Promise<void>;
}

export type PayMethod = 'transfer' | 'card';

const CHANNELS: Record<PayMethod, readonly string[]> = {
  transfer: ['bank_transfer'],
  card: ['card', 'ussd'],
};

/**
 * The channels to open for the chosen method, out of those the platform offered. Never one it did not offer;
 * when none of the method's channels was offered, the platform's own list stands, so the buyer can still pay.
 */
export function channelsFor(method: PayMethod, offered: readonly string[]): string[] {
  const chosen = offered.filter((channel) => CHANNELS[method].includes(channel));
  return chosen.length > 0 ? chosen : [...offered];
}

const INLINE_SRC = 'https://js.paystack.co/v2/inline.js';

interface PaystackPopInstance {
  newTransaction: (options: Record<string, unknown>) => void;
}
type PaystackPopConstructor = new () => PaystackPopInstance;

let loading: Promise<PaystackPopConstructor> | undefined;

const popFromWindow = (): PaystackPopConstructor | undefined =>
  (window as unknown as { PaystackPop?: PaystackPopConstructor }).PaystackPop;

function loadInline(): Promise<PaystackPopConstructor> {
  const ready = popFromWindow();
  if (ready !== undefined) return Promise.resolve(ready);
  loading ??= new Promise<PaystackPopConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = INLINE_SRC;
    script.async = true;
    script.onload = () => {
      const pop = popFromWindow();
      if (pop === undefined) reject(new Error('Paystack Inline did not load'));
      else resolve(pop);
    };
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Paystack Inline did not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Paystack Inline v2, loaded on first use. */
export const paystackCheckout: Checkout = {
  open: async (setup, { onSuccess, onClose }) => {
    const PaystackPop = await loadInline();
    new PaystackPop().newTransaction({
      key: setup.key,
      email: setup.email,
      amount: setup.amount,
      currency: setup.currency,
      reference: setup.reference,
      channels: setup.channels,
      onSuccess: () => onSuccess(),
      onCancel: () => onClose(),
      onError: () => onClose(),
    });
  },
};
