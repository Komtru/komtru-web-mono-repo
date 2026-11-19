'use client';
// Query hooks for the dispute screens (F-032).
//
// Everything about a dispute hangs off `['trades', tradeId, 'dispute']`, so the trade-wide
// invalidation the workspace already does picks the case up too, and a screen that opens a
// dispute does not have to know which other screens were reading it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appealDispute,
  getDispute,
  getDisputeTimeline,
  getEvidenceComparison,
  getTradeDispute,
  listDisputeEvidence,
  listDisputes,
  openDispute,
  proposeSettlement,
  respondToSettlement,
  submitDisputeEvidence,
  withdrawDispute,
  type DecisionOutcome,
  type DisputeCategory,
  type DisputeStatus,
} from '../disputes.js';
import { useApiClient } from './client-context.js';

export const disputeKeys = {
  all: ['disputes'] as const,
  list: (status?: DisputeStatus) => ['disputes', 'list', status ?? 'all'] as const,
  /** Under the trade, so one trade invalidation refetches the case with everything else. */
  forTrade: (tradeId: string) => ['trades', tradeId, 'dispute'] as const,
  one: (disputeId: string) => ['disputes', disputeId] as const,
  timeline: (disputeId: string) => ['disputes', disputeId, 'timeline'] as const,
  evidence: (disputeId: string) => ['disputes', disputeId, 'evidence'] as const,
  comparison: (disputeId: string) => ['disputes', disputeId, 'comparison'] as const,
};

/** The case on a trade, if there is one. `enabled` lets the workspace ask only where it matters. */
export function useTradeDispute(tradeId: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: disputeKeys.forTrade(tradeId),
    queryFn: ({ signal }) => client.call(getTradeDispute, { params: { id: tradeId } }, { signal }),
    enabled,
  });
}

export function useDispute(disputeId: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: disputeKeys.one(disputeId),
    queryFn: ({ signal }) => client.call(getDispute, { params: { id: disputeId } }, { signal }),
    enabled,
  });
}

export function useDisputeTimeline(disputeId: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: disputeKeys.timeline(disputeId),
    queryFn: ({ signal }) =>
      client.call(getDisputeTimeline, { params: { id: disputeId }, query: { limit: 50 } }, { signal }),
    enabled,
  });
}

export function useDisputeEvidence(disputeId: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: disputeKeys.evidence(disputeId),
    queryFn: ({ signal }) =>
      client.call(listDisputeEvidence, { params: { id: disputeId }, query: { limit: 20 } }, { signal }),
    enabled,
  });
}

/** Y1. */
export function useEvidenceComparison(disputeId: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: disputeKeys.comparison(disputeId),
    queryFn: ({ signal }) => client.call(getEvidenceComparison, { params: { id: disputeId } }, { signal }),
    enabled,
  });
}

export function useMyDisputes(status?: DisputeStatus) {
  const client = useApiClient();
  return useQuery({
    queryKey: disputeKeys.list(status),
    queryFn: ({ signal }) =>
      client.call(listDisputes, { query: { limit: 20, ...(status ? { status } : {}) } }, { signal }),
  });
}

/** C7 / CWT-S14. On success the whole trade is refetched: its status has moved to DISPUTED. */
export function useOpenDispute() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tradeId,
      category,
      reason,
    }: {
      tradeId: string;
      category: DisputeCategory;
      reason: string;
    }) => client.call(openDispute, { params: { id: tradeId }, body: { category, reason } }),
    onSuccess: (_answer, { tradeId }) => {
      void queryClient.invalidateQueries({ queryKey: ['trades', tradeId] });
    },
  });
}

export function useSubmitDisputeEvidence() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, fileRefId, note }: { disputeId: string; fileRefId?: string; note?: string }) =>
      client.call(submitDisputeEvidence, {
        params: { id: disputeId },
        body: { ...(fileRefId ? { fileRefId } : {}), ...(note ? { note } : {}) },
      }),
    onSuccess: (_answer, { disputeId }) => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.evidence(disputeId) });
      void queryClient.invalidateQueries({ queryKey: disputeKeys.comparison(disputeId) });
    },
  });
}

export function useProposeSettlement() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      disputeId,
      outcome,
      amountToBuyerMinor,
      amountToSellerMinor,
      note,
    }: {
      disputeId: string;
      outcome: DecisionOutcome;
      amountToBuyerMinor: string;
      amountToSellerMinor: string;
      note?: string;
    }) =>
      client.call(proposeSettlement, {
        params: { id: disputeId },
        body: { outcome, amountToBuyerMinor, amountToSellerMinor, ...(note ? { note } : {}) },
      }),
    onSuccess: (_answer, { disputeId }) => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.one(disputeId) });
    },
  });
}

/** Accepting resolves the case, so the trade is invalidated too — its money is about to move. */
export function useRespondToSettlement() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      disputeId,
      proposalId,
      accept,
    }: {
      disputeId: string;
      proposalId: string;
      accept: boolean;
      tradeId: string;
    }) =>
      client.call(respondToSettlement, {
        params: { id: disputeId, proposalId },
        body: { accept },
      }),
    onSuccess: (_answer, { disputeId, tradeId }) => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.one(disputeId) });
      void queryClient.invalidateQueries({ queryKey: ['trades', tradeId] });
    },
  });
}

/** SP-M23. */
export function useWithdrawDispute() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, reason }: { disputeId: string; reason: string; tradeId: string }) =>
      client.call(withdrawDispute, { params: { id: disputeId }, body: { reason } }),
    onSuccess: (_answer, { disputeId, tradeId }) => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.one(disputeId) });
      void queryClient.invalidateQueries({ queryKey: ['trades', tradeId] });
    },
  });
}

/** AC6. */
export function useAppealDispute() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, reason }: { disputeId: string; reason: string }) =>
      client.call(appealDispute, { params: { id: disputeId }, body: { reason } }),
    onSuccess: (_answer, { disputeId }) => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.one(disputeId) });
      void queryClient.invalidateQueries({ queryKey: disputeKeys.timeline(disputeId) });
    },
  });
}
