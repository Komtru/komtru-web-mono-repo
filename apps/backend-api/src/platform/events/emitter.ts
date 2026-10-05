// The in-process emitter (design §4.3).
//
// USE THIS ONLY for effects that are safe to lose and cheap to recompute — cache invalidation,
// socket fan-out, in-memory counters. It is lossy by construction: listeners live in one process,
// so nothing reaches the other API instances or the worker, and a crash between the emit and the
// listener loses the effect with no trace.
//
// Anything a user, a balance or an audit trail depends on goes through the outbox (publish.ts), in
// the same transaction as the state change. If losing the effect would be a bug, it is not this.
import type { EventDefinition } from '@komtru/shared-types';
import type { z } from 'zod';
import type { Logger } from '../logger.js';

type Listener = (payload: never) => unknown;

export interface InProcessEmitter {
  /** Returns the function that removes this listener. */
  on<S extends z.ZodType>(
    definition: EventDefinition<S>,
    listener: (payload: z.output<S>) => unknown,
  ): () => void;
  emit<S extends z.ZodType>(definition: EventDefinition<S>, payload: z.output<S>): void;
}

export function createInProcessEmitter(logger: Logger): InProcessEmitter {
  const listeners = new Map<string, Listener[]>();

  return {
    on(definition, listener) {
      const existing = listeners.get(definition.eventType) ?? [];
      listeners.set(definition.eventType, [...existing, listener]);
      return () => {
        listeners.set(
          definition.eventType,
          (listeners.get(definition.eventType) ?? []).filter((l) => l !== listener),
        );
      };
    },
    emit(definition, payload) {
      for (const listener of listeners.get(definition.eventType) ?? []) {
        // One listener's failure is its own: the emitter's callers are mid-transaction elsewhere.
        try {
          const result = (listener as (p: unknown) => unknown)(payload);
          if (result instanceof Promise) {
            result.catch((error: unknown) =>
              logger.error({ err: error, eventType: definition.eventType }, 'events: listener failed'),
            );
          }
        } catch (error) {
          logger.error({ err: error, eventType: definition.eventType }, 'events: listener failed');
        }
      }
    },
  };
}
