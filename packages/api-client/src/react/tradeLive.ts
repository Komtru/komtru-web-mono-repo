'use client';

// A trade that stays current without being asked (T-068's client contract, `2026-11-09-f-022-realtime.md`).
//
//   * A push is a signal to refetch, never data. Nothing here reads the payload except to decide whether to
//     refetch: what each party may see is decided by the HTTP read, which a push cannot bypass.
//   * Rooms are lost on every disconnect, and a push the server could not deliver is never replayed. So on EVERY
//     `connect` (the first and each reconnect) every open trade's room is joined again, and once the join is
//     answered the trade is refetched: whatever happened while the socket was down is only recoverable that way.
//   * Every push causes a read, whatever its `occurredAt`. An earlier version dropped a push older than the last
//     read, comparing the SERVER's time with this device's clock; a device a few minutes fast then dropped every
//     push and the screen silently stopped updating. A read is idempotent and TanStack Query shares one in
//     flight, so a redelivered or out-of-order push costs at most one extra GET and can never hide a change.
//   * Where there is no live connection (no socket URL, not connected yet, dropped, or a room refused), the
//     trade is read on a timer instead, so a screen never depends on a push it will not get.
import {
  TRADE_ROOM_PREFIX,
  TRADE_UPDATED_EVENT,
  tradeUpdateSchema,
  type TradeUpdate,
} from '@komtru/shared-types';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { tradeKeys } from './trades.js';
import { useSocket } from './realtime.js';

export interface LiveTrade {
  /** The trade's id: what its queries are keyed by. */
  id: string;
  /** The canonical trade code, which is the room's name. */
  code: string;
}

/** How often a trade is read while nothing is pushing it to this device. */
export const FALLBACK_POLL_MS = 30_000;

/** `{ joined: true }` and nothing else is a join. Any other answer, or none, is not. */
const isJoined = (ack: unknown): boolean =>
  typeof ack === 'object' && ack !== null && (ack as { joined?: unknown }).joined === true;

/** What is refetched for one trade: its own reads (trade, activity, deadline, inspection) and every list. */
export function refetchTrade(queryClient: QueryClient, id: string): void {
  void queryClient.invalidateQueries({ queryKey: tradeKeys.one(id) });
  void queryClient.invalidateQueries({ queryKey: ['trades', 'list'] });
}

export interface TradeLive {
  /** Codes whose room the gateway refused. They are read on a timer instead (see `FALLBACK_POLL_MS`). */
  refused: readonly string[];
}

/** Keeps the given trades current for as long as the component is mounted. */
export function useTradeLive(trades: readonly LiveTrade[]): TradeLive {
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();
  const [refused, setRefused] = useState<readonly string[]>([]);

  const latest = useRef(trades);
  latest.current = trades;
  const isConnected = useRef(connected);
  isConnected.current = connected;
  // Joining depends on WHICH rooms, not on a new array every render.
  const rooms = useMemo(
    () =>
      trades
        .map((trade) => trade.code)
        .sort()
        .join(','),
    [trades],
  );

  useEffect(() => {
    if (!socket) return undefined;
    let active = true;

    // Asks for one room and says whether it was joined. A refused or failed join is not an error for the
    // screen: it still works by reading the trade, which is why the answer only feeds `refused`.
    const join = async (trade: LiveTrade): Promise<void> => {
      let joined = false;
      try {
        joined = isJoined(
          await socket.emitWithAck('room:join', { prefix: TRADE_ROOM_PREFIX, id: trade.code }),
        );
      } catch {
        // The emit itself failed (the socket dropped mid-ask). Not joined; the next connect rejoins.
      }
      if (!active) return;
      setRefused((current) =>
        joined
          ? current.filter((code) => code !== trade.code)
          : current.includes(trade.code)
            ? current
            : [...current, trade.code],
      );
    };
    const joinAll = () => {
      const open = latest.current;
      // Once every room is answered, read everything again, once: whatever happened before the join, or while
      // the socket was down, is only behind the API. One read per trade and one of the lists, however many rooms.
      void Promise.all(open.map(join)).then(() => {
        if (!active) return;
        for (const trade of open) void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id) });
        void queryClient.invalidateQueries({ queryKey: ['trades', 'list'] });
      });
    };

    const onUpdate = (payload: unknown) => {
      const parsed = tradeUpdateSchema.safeParse(payload);
      if (!parsed.success) return;
      const trade = latest.current.find((candidate) => candidate.code === parsed.data.tradeCode);
      if (!trade) return;
      refetchTrade(queryClient, trade.id);
    };

    socket.on('connect', joinAll);
    socket.on(TRADE_UPDATED_EVENT, onUpdate);
    // Already connected when this mounted: no `connect` is coming for it.
    if (isConnected.current) joinAll();

    return () => {
      active = false;
      socket.off('connect', joinAll);
      socket.off(TRADE_UPDATED_EVENT, onUpdate);
    };
  }, [socket, rooms, queryClient]);

  // The fallback: read on a timer while the push channel is not delivering. `refused` is a room the gateway
  // said no to; `connected` is false with no socket URL, before the first connection and after a drop.
  const polling = !connected || refused.length > 0;
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(() => {
      for (const trade of latest.current) refetchTrade(queryClient, trade.id);
    }, FALLBACK_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [polling, queryClient]);

  return { refused };
}
