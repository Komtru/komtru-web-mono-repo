'use client';

// A trade that stays current without being asked (T-068's client contract, `2026-11-09-f-022-realtime.md`).
//
//   * A push is a signal to refetch, never data. Nothing here reads the payload except to decide whether to
//     refetch: what each party may see is decided by the HTTP read, which a push cannot bypass.
//   * Rooms are lost on every disconnect, and a push the server could not deliver is never replayed. So on EVERY
//     `connect` (the first and each reconnect) every open trade's room is joined again, and once the join is
//     answered the trade is refetched: whatever happened while the socket was down is only recoverable that way.
//   * A push whose `occurredAt` is not after the last completed read of that trade is dropped: it is already in
//     what is on screen (pushes can be redelivered and can arrive out of order).
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

/**
 * Server and device clocks disagree. A push is dropped only when it is older than the last read by more than
 * this, so a modest skew costs one redundant refetch and never a missed update. A device clock more than this
 * far ahead of the server can still hide a push; the refetch on every reconnect and the periodic one bound it.
 */
export const PUSH_SKEW_ALLOWANCE_MS = 60_000;

/** `{ joined: true }` and nothing else is a join. Any other answer, or none, is not. */
const isJoined = (ack: unknown): boolean =>
  typeof ack === 'object' && ack !== null && (ack as { joined?: unknown }).joined === true;

/** Whether a push is already reflected in what was last read. Pure, so the rule is testable alone. */
export function isStalePush(
  update: Pick<TradeUpdate, 'occurredAt'>,
  lastReadAt: number | undefined,
): boolean {
  if (lastReadAt === undefined || lastReadAt === 0) return false;
  return Date.parse(update.occurredAt) <= lastReadAt - PUSH_SKEW_ALLOWANCE_MS;
}

/** What is refetched for one trade: its own reads (trade, activity, deadline, inspection) and every list. */
export function refetchTrade(queryClient: QueryClient, id: string): void {
  void queryClient.invalidateQueries({ queryKey: tradeKeys.one(id) });
  void queryClient.invalidateQueries({ queryKey: ['trades', 'list'] });
}

export interface TradeLive {
  /** Codes whose room the gateway refused. The screen still works, by refetching when it is shown. */
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
      const read =
        queryClient.getQueryState(tradeKeys.one(trade.id))?.dataUpdatedAt ??
        queryClient.getQueryState(tradeKeys.list('ALL'))?.dataUpdatedAt;
      if (isStalePush(parsed.data, read)) return;
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

  return { refused };
}
