import { describe, expect, it, vi } from 'vitest';
import { attachRealtime, type SocketLike } from '../../src/realtime/connection.js';

type Handler = (...args: never[]) => void;

const fakeSocket = () => {
  const socketHandlers = new Map<string, Set<Handler>>();
  const managerHandlers = new Map<string, Set<Handler>>();

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

  const emit = (map: Map<string, Set<Handler>>, event: string, ...args: unknown[]) => {
    for (const handler of [...(map.get(event) ?? [])]) (handler as (...a: unknown[]) => void)(...args);
  };

  const socket: SocketLike = {
    ...bind(socketHandlers),
    disconnect: vi.fn(),
    io: bind(managerHandlers),
  };

  return {
    socket,
    emit: (event: string, ...args: unknown[]) => emit(socketHandlers, event, ...args),
    emitManager: (event: string) => emit(managerHandlers, event),
    listenerCount: () =>
      [...socketHandlers.values(), ...managerHandlers.values()].reduce((total, set) => total + set.size, 0),
  };
};

describe('attachRealtime', () => {
  it('reports connect and disconnect', () => {
    const { socket, emit } = fakeSocket();
    const onConnectedChange = vi.fn();
    attachRealtime({ socket, onConnectedChange });

    emit('connect');
    emit('disconnect');

    expect(onConnectedChange.mock.calls).toEqual([[true], [false]]);
  });

  it('resyncs on a reconnect, never on the first connect', () => {
    // The socket is a hint that something changed; the API is the truth (socket guide §9). A
    // resync on the first connect would double every page's initial fetch.
    const { socket, emit, emitManager } = fakeSocket();
    const onResync = vi.fn();
    attachRealtime({ socket, onResync });

    emit('connect');
    expect(onResync).not.toHaveBeenCalled();

    emitManager('reconnect');
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('delivers events to a subscriber and stops on unsubscribe', () => {
    const { socket, emit } = fakeSocket();
    const received: unknown[] = [];
    const detach = attachRealtime({ socket });
    const unsubscribe = detach.on('notification', (payload) => received.push(payload));

    emit('notification', { id: 'n1' });
    unsubscribe();
    emit('notification', { id: 'n2' });

    expect(received).toEqual([{ id: 'n1' }]);
  });

  it('removes every listener it added when it is detached', () => {
    const { socket, listenerCount } = fakeSocket();
    const detach = attachRealtime({ socket, onConnectedChange: vi.fn(), onResync: vi.fn() });
    expect(listenerCount()).toBeGreaterThan(0);

    detach.close();

    expect(listenerCount()).toBe(0);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
