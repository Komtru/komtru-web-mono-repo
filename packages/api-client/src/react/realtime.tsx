'use client';

// The socket provider from `docs/specs/socket-notifications-frontend-setup.md`, with two deliberate
// corrections to the guide's sample:
//
//   * the socket is held in state, not a ref. The guide's version puts it in a ref and renders
//     `socketRef.current`, which is `null` on the first render and never re-renders when it fills
//     in, so no consumer ever receives the socket.
//   * `connect` is injectable. The default lazily imports socket.io-client inside the effect, so the
//     module is only ever loaded in a browser, and a test can hand in a fake instead.
//
// Everything the lifecycle does lives in `attachRealtime` (isomorphic); this file is the binding.
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { attachRealtime, type RealtimeConnection, type SocketLike } from '../realtime/connection.js';

export const NOTIFICATION_EVENT = 'notification';

export interface LiveNotification {
  id: string;
  receivedAt: number;
  payload: unknown;
}

export interface SocketContextValue {
  socket: SocketLike | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

/**
 * `token` is the one to connect with; `latestToken` reads the newest at any later time. A connection that
 * reconnects (after a drop, or a server restart) must present the token that is current THEN, not the one it
 * first connected with: by then that one has expired, and the reconnect would fail for good.
 */
export type SocketFactory = (
  url: string,
  token: string,
  latestToken?: () => string,
) => SocketLike | Promise<SocketLike>;

/**
 * Imported inside the effect, never at module scope: an app that renders this file on the server
 * (every Next app does, to produce the client reference) must not pull socket.io-client into Node.
 */
const defaultConnect: SocketFactory = async (url, token, latestToken) => {
  const { io } = (await import('socket.io-client')) as unknown as {
    io: (url: string, options: unknown) => SocketLike;
  };
  // `forceNew` because socket.io caches one Manager per URL and only honours `auth` when the socket is first
  // created. `auth` is a function, which socket.io calls on EVERY handshake (the first and each reconnect), so
  // a reconnect carries the newest token and not the one this socket was opened with.
  return io(url, {
    auth: (give: (data: { token: string }) => void) => {
      give({ token: latestToken?.() ?? token });
    },
    forceNew: true,
  });
};

export interface SocketProviderProps {
  /** The short-lived, socket-scoped token the Server Component layout minted (socket guide §6). */
  token: string;
  url?: string;
  /** Invalidated on every reconnect. Omit to invalidate everything, which is the safe default. */
  resyncQueryKeys?: readonly (readonly unknown[])[];
  connect?: SocketFactory;
  /**
   * Produces a fresh access token, or `null` when the session is over. Called when the gateway says the
   * token has lapsed (`auth:refresh`): a screen that is only listening makes no request, so nothing else
   * would refresh it, and the gateway would revoke the socket. The result is sent back as `auth:token`.
   */
  refreshToken?: () => Promise<string | null>;
  children: ReactNode;
}

export function SocketProvider({
  token,
  url,
  resyncQueryKeys,
  connect = defaultConnect,
  refreshToken,
  children,
}: SocketProviderProps) {
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<SocketLike | null>(null);
  const [connected, setConnected] = useState(false);

  // Held in a ref so changing the resync list does not tear the connection down and rebuild it.
  const resyncKeys = useRef(resyncQueryKeys);
  resyncKeys.current = resyncQueryKeys;

  // The token the connection was made with. A token that changes afterwards is forwarded to the gateway as
  // `auth:token`, which keeps its authorisation current without dropping the socket (and every room joined on
  // it) on each refresh.
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refresher = useRef(refreshToken);
  refresher.current = refreshToken;
  const connectedWith = useRef<string | null>(null);

  const target = url ?? process.env.NEXT_PUBLIC_SOCKET_URL;
  const live = target !== undefined && target !== '' && token !== '';

  useEffect(() => {
    if (!live || !target) return undefined;
    let connection: RealtimeConnection | undefined;
    let cancelled = false;

    void (async () => {
      const connectedToken = tokenRef.current;
      const opened = await connect(target, connectedToken, () => tokenRef.current);
      // Unmounted while the socket.io module was still loading: close it rather than leaking it.
      if (cancelled) {
        opened.disconnect();
        return;
      }
      connectedWith.current = connectedToken;
      connection = attachRealtime({
        socket: opened,
        onConnectedChange: setConnected,
        onResync: () => {
          // A live event is "something changed, go check" — never the only copy of the truth.
          // Whatever was missed while the socket was down is behind the API (socket guide §9).
          const keys = resyncKeys.current;
          if (!keys) {
            void queryClient.invalidateQueries();
            return;
          }
          for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
        },
      });
      // "Your token has lapsed; send a fresh one or you will be disconnected." Answer it by refreshing, not by
      // waiting for some request to do so: an idle screen makes none.
      connection.on('auth:refresh', () => {
        const refresh = refresher.current;
        if (!refresh) return;
        void refresh()
          .then((fresh) => {
            if (fresh === null || fresh === '' || cancelled) return;
            tokenRef.current = fresh;
            connectedWith.current = fresh;
            opened.emit('auth:token', { token: fresh });
          })
          .catch(() => undefined);
      });
      setSocket(opened);
    })();

    return () => {
      cancelled = true;
      connection?.close();
      connectedWith.current = null;
      setSocket(null);
      setConnected(false);
    };
    // Only whether there is somewhere and someone to connect as belongs in here. `connect`, `queryClient` and
    // the token's later values are not: re-running on them would tear the connection down on every render of
    // a parent that passes an inline factory, or on every token refresh.
  }, [target, live]);

  useEffect(() => {
    if (socket === null || connectedWith.current === token) return;
    connectedWith.current = token;
    socket.emit('auth:token', { token });
  }, [socket, token]);

  const value = useMemo<SocketContextValue>(() => ({ socket, connected }), [socket, connected]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export const useSocket = (): SocketContextValue => useContext(SocketContext);

/** Subscribes for as long as the component is mounted. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const { socket } = useSocket();
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!socket) return undefined;
    const listen = (payload: T) => latest.current(payload);
    socket.on(event, listen);
    return () => socket.off(event, listen);
  }, [socket, event]);
}

export interface NotificationContextValue {
  notifications: LiveNotification[];
  unreadCount: number;
  markAllRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => undefined,
});

export interface NotificationProviderProps {
  children: ReactNode;
  /** How many live notifications to keep in memory; the history lives behind the API. */
  limit?: number;
  newId?: () => string;
  now?: () => number;
}

export function NotificationProvider({
  children,
  limit = 50,
  newId = () => crypto.randomUUID(),
  now = Date.now,
}: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useSocketEvent(NOTIFICATION_EVENT, (payload: unknown) => {
    setNotifications((previous) =>
      [{ id: newId(), receivedAt: now(), payload }, ...previous].slice(0, limit),
    );
    setUnreadCount((count) => count + 1);
  });

  const markAllRead = useCallback(() => setUnreadCount(0), []);
  const value = useMemo<NotificationContextValue>(
    () => ({ notifications, unreadCount, markAllRead }),
    [notifications, unreadCount, markAllRead],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export const useNotifications = (): NotificationContextValue => useContext(NotificationContext);

export type RealtimeProviderProps = SocketProviderProps & Omit<NotificationProviderProps, 'children'>;

/** What an app's `(authed)` layout mounts: one socket and the user's own notification stream. */
export function RealtimeProvider({ children, limit, newId, now, ...socketProps }: RealtimeProviderProps) {
  return (
    <SocketProvider {...socketProps}>
      <NotificationProvider {...{ limit, newId, now }}>{children}</NotificationProvider>
    </SocketProvider>
  );
}
