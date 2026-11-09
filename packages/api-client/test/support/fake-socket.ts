import { vi, type Mock } from 'vitest';
import type { SocketLike } from '../../src/realtime/connection.js';

type Handler = (...args: never[]) => void;

/**
 * A socket that does what socket.io-client does for the parts the trade screens rely on: it fires `connect`
 * on every (re)connection, answers `emitWithAck`, and can be told to refuse a room or fail the emit.
 */
export interface FakeSocket {
  socket: SocketLike;
  emit: Mock<(event: string, ...args: unknown[]) => unknown>;
  emitWithAck: Mock<(event: string, payload?: unknown) => Promise<unknown>>;
  answerJoins: (next: (payload: unknown) => unknown) => void;
  fire: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
  joins: () => unknown[];
}

export function fakeSocket(): FakeSocket {
  const handlers = new Map<string, Set<Handler>>();
  const manager = new Map<string, Set<Handler>>();
  const bind = (map: Map<string, Set<Handler>>) => ({
    on: (event: string, handler: Handler) => {
      const set = map.get(event) ?? new Set<Handler>();
      set.add(handler);
      map.set(event, set);
    },
    off: (event: string, handler: Handler) => {
      map.get(event)?.delete(handler);
    },
  });

  let answer: (event: string, payload: unknown) => Promise<unknown> = () => Promise.resolve({ joined: true });
  const emitWithAck = vi.fn((event: string, payload?: unknown) => answer(event, payload));
  const emit = vi.fn();

  const socket: SocketLike = {
    ...bind(handlers),
    disconnect: vi.fn(),
    emit,
    emitWithAck,
    io: bind(manager),
  };

  return {
    socket,
    emit,
    emitWithAck,
    /** What the gateway answers to a room join. */
    answerJoins: (next: (payload: unknown) => unknown) => {
      answer = (_event, payload) => Promise.resolve(next(payload));
    },
    fire: (event: string, ...args: unknown[]) => {
      for (const handler of [...(handlers.get(event) ?? [])]) (handler as (...a: unknown[]) => void)(...args);
    },
    listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
    joins: () =>
      emitWithAck.mock.calls.filter(([event]) => event === 'room:join').map(([, payload]) => payload),
  };
}
