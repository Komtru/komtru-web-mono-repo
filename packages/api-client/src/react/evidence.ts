'use client';

// Evidence on a live trade (F-028): what was added under an event, and adding more.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachEvidence,
  listTradeEvidence,
  MAX_EVIDENCE_PER_EVENT,
  type EvidenceEvent,
} from '../evidence.js';
import { useApiClient } from './client-context.js';

/** Everything read about one trade sits under `['trades', id]`, so a trade-wide invalidation refetches this too. */
export const evidenceKeys = {
  all: (id: string) => ['trades', id, 'evidence'] as const,
  event: (id: string, event: EvidenceEvent) => ['trades', id, 'evidence', event] as const,
};

/**
 * The media added under one event, oldest first. One page is the whole answer: the platform allows
 * `MAX_EVIDENCE_PER_EVENT` files an event, and the page asked for is larger than that.
 */
export function useTradeEvidence(id: string, event: EvidenceEvent, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: evidenceKeys.event(id, event),
    queryFn: ({ signal }) =>
      client.call(
        listTradeEvidence,
        { params: { id }, query: { event, limit: MAX_EVIDENCE_PER_EVENT * 2 } },
        { signal },
      ),
    enabled,
  });
}

/** Attach finished uploads under an event. The reads of that trade's evidence are refetched on success. */
export function useAttachEvidence() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, event, fileIds }: { id: string; event: EvidenceEvent; fileIds: string[] }) =>
      client.call(attachEvidence, { params: { id }, body: { event, fileIds } }),
    onSuccess: (_answer, { id }) => {
      void queryClient.invalidateQueries({ queryKey: evidenceKeys.all(id) });
    },
  });
}
