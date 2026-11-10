'use client';

// Funding a trade (F-024). The status is the screen: which of V1, V2, AB3, AB4 or V3 the buyer sees is the
// platform's `displayState`, read here and polled while the platform is still verifying with Paystack.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmPayment,
  getPaymentStatus,
  initiatePayment,
  type InitiatedPayment,
  type PaymentStatus,
} from '../payments.js';
import { useApiClient } from './client-context.js';
import { tradeKeys } from './trades.js';

/** How often a verifying payment is asked about again. AB3 promises "usually under 30 seconds". */
export const PAYMENT_POLL_MS = 4000;

/** Under `tradeKeys.one(id)`, so a push that refetches the trade refetches its payment too. */
export const paymentKey = (tradeId: string) => [...tradeKeys.one(tradeId), 'payment'] as const;

/** Where the trade's payment stands, for its buyer. Polls while `VERIFYING`, and only then. */
export function usePaymentStatus(tradeId: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: paymentKey(tradeId),
    queryFn: ({ signal }) => client.call(getPaymentStatus, { params: { code: tradeId } }, { signal }),
    enabled,
    refetchInterval: (query) => (query.state.data?.displayState === 'VERIFYING' ? PAYMENT_POLL_MS : false),
  });
}

const asStatus = ({ tradeId, tradeCode, displayState, attempt }: InitiatedPayment): PaymentStatus => ({
  tradeId,
  tradeCode,
  displayState,
  attempt,
});

/** A payment attempt and the Inline setup; the status cache takes the attempt it answers with. */
export function useInitiatePayment(tradeId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { restart?: boolean }) =>
      client.call(initiatePayment, { params: { code: tradeId }, body }),
    onSuccess: (answer) => {
      queryClient.setQueryData(paymentKey(tradeId), asStatus(answer));
    },
  });
}

/**
 * "The checkout finished" or "check again". The platform verifies with Paystack and answers with where the
 * payment now stands; the trade itself is refetched, since a payment already settled has moved it.
 */
export function useConfirmPayment(tradeId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.call(confirmPayment, { params: { code: tradeId } }),
    onSuccess: (answer) => {
      queryClient.setQueryData(paymentKey(tradeId), answer);
      void queryClient.invalidateQueries({ queryKey: tradeKeys.one(tradeId), exact: true });
    },
  });
}
