# Kumtru — Frontend Global Socket & Notification Listener Setup (Next.js, App Router)

**Setup guide** · 22 August 2026

---

## Scope

This covers the plumbing only: a single socket connection per session, managed once for the whole authenticated section of the app, and a generic way for any component to receive notifications directed at the current user. It does not cover what a notification looks like, how it's rendered, or any feature-specific room (the dispute mediation chat, for instance) — those are consumers of what's set up here, not part of it. Backend counterpart: the companion `socket-module-backend-setup.md` document.

**Corrects a framework assumption from an earlier draft of this doc:** the App Router changes three real things about how this gets wired up, not just file extensions — where the provider mounts (a route-group layout, not a blanket root wrap), the client/server component boundary (Context and `socket.io-client` can only live in Client Components), and how the socket gets an auth credential in the first place (a Server Component can resolve the session; a Client Component generally can't read an httpOnly cookie directly). All three are addressed below.

---

## 1. What this is responsible for

- One `socket.io-client` connection per session, created once for the authenticated part of the app, not per-page and not per-component
- Authenticating that connection off the same session the rest of the app already trusts — never a second credential store
- Automatically receiving anything the backend pushes to the user's personal room (see backend doc §7) — no per-feature wiring needed for "the user gets notified"
- Giving any component a simple way to subscribe to a socket event and clean up automatically on unmount
- Reconnecting gracefully, and re-syncing from the real API on reconnect rather than trusting nothing was missed while disconnected
- Never opening a connection at all for public/unauthenticated routes (login, marketing pages) — this is scoped to the authed section of the app by construction, not by an `if (loggedIn)` check sprinkled into a global provider

---

## 2. Dependency

```bash
npm install socket.io-client
```

---

## 3. Environment variable

```
NEXT_PUBLIC_SOCKET_URL=      # the socket server's origin — almost certainly a different
                              # origin than the Next.js app itself, since Socket.IO needs a
                              # persistent process (the backend from Module 0), not a
                              # serverless/edge function
```

---

## 4. Where this lives: a route-group layout, not the root layout

Most Next.js apps have routes that shouldn't open a socket connection at all — a login page, marketing pages, a public listing browse. The natural boundary is a route group scoped to the authenticated section:

```
app/
  layout.tsx                  ← root layout: global providers that apply everywhere
                                 (theme, etc.) — no socket/notification code here
  (public)/
    login/page.tsx
    page.tsx                  ← marketing/landing
  (authed)/
    layout.tsx                ← THIS is where the socket connection gets established
    dashboard/page.tsx
    transactions/page.tsx
    disputes/[id]/page.tsx
```

`app/(authed)/layout.tsx` is a Server Component by default. That's useful here: it can verify the session and redirect unauthenticated requests to `/login` *before any client-side code runs at all* — the socket connection genuinely never gets attempted for a logged-out visitor, rather than mounting and immediately no-op'ing.

---

## 5. The client/server boundary

React Context, `useState`/`useEffect`, and a live `socket.io-client` instance are all inherently client-side — none of that can execute in a Server Component. So the layout splits into two pieces: the Server Component does the auth check and hands off a credential, a Client Component underneath it actually owns the connection.

```tsx
// app/(authed)/layout.tsx  (Server Component — no "use client")
import { redirect } from "next/navigation";
import { getServerSession } from "@/auth/session"; // swap in whatever this app's
                                                     // real session helper is
import { mintSocketToken } from "@/auth/socketToken"; // see §6
import { RealtimeProviders } from "@/realtime/RealtimeProviders";

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const socketToken = await mintSocketToken(session);

  return <RealtimeProviders token={socketToken}>{children}</RealtimeProviders>;
}
```

Everything under `app/(authed)/` is guaranteed to have a verified session and a socket token available before it renders — no client-side "wait for auth to resolve" flicker.

---

## 6. Getting a credential to the client safely

If the session is an httpOnly cookie (typical for Auth.js/NextAuth and most custom setups), client-side JavaScript can't read it directly — and since the socket server is a different origin from the Next.js app (§3), the browser won't necessarily send that cookie along with the socket handshake either, without extra cross-site cookie configuration that's fragile to depend on.

The straightforward fix: mint a short-lived, socket-scoped token server-side, using the session the Server Component layout already verified, and hand *that* to the client — never the long-lived session credential itself.

```ts
// auth/socketToken.ts (server-only)
import jwt from "jsonwebtoken";
import type { Session } from "@/auth/session";

export async function mintSocketToken(session: Session) {
  return jwt.sign(
    { sub: session.userId, principalType: session.principalType }, // CONSUMER | STAFF
    process.env.SOCKET_AUTH_TOKEN_SECRET!, // same secret the backend's socket auth checks
    { expiresIn: "5m" } // short-lived — reminted on every page load via the layout above
  );
}
```

This reuses the exact verification the backend socket module already expects (`socket.handshake.auth.token`, checked against `SOCKET_AUTH_TOKEN_SECRET` — see backend doc §6) — nothing changes on the backend side for this to work.

**Alternative, if it fits your setup better:** if the socket server is deployed to share a cookie domain with the Next.js app (e.g. both under `*.kumtru.com` with a cookie set at `domain=.kumtru.com`), you can instead connect with `{ withCredentials: true }` and have the backend read the session cookie directly during the handshake, skipping token-minting entirely. Pick one approach — don't run both.

---

## 7. RealtimeProviders (Client Component)

This is the piece that actually owns the socket connection and the notification state. It receives the short-lived token as a prop from the Server Component layout above — it doesn't fetch its own auth state.

```tsx
// realtime/RealtimeProviders.tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from "react";
import { io, Socket } from "socket.io-client";

// --- Socket context -------------------------------------------------------

type SocketContextValue = { socket: Socket | null; connected: boolean };
const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

function SocketProvider({ token, children }: { token: string; children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL!, {
      auth: { token },
      // socket.io-client reconnects with backoff by default — no custom
      // reconnection logic needed here.
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

// --- Generic event-subscription hook --------------------------------------

export function useSocketEvent<T = unknown>(eventName: string, handler: (payload: T) => void) {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    socket.on(eventName, handler);
    return () => {
      socket.off(eventName, handler);
    };
  }, [socket, eventName, handler]);
}

// --- Notification context ---------------------------------------------------

type LiveNotification = { id: string; receivedAt: number; payload: unknown };
type NotificationContextValue = {
  notifications: LiveNotification[];
  unreadCount: number;
  markAllRead: () => void;
};

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
});

function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useSocketEvent("notification", (payload: unknown) => {
    setNotifications((prev) => [
      { id: crypto.randomUUID(), receivedAt: Date.now(), payload },
      ...prev,
    ]);
    setUnreadCount((n) => n + 1);
  });

  const markAllRead = useCallback(() => setUnreadCount(0), []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}

// --- Combined export used by the layout ------------------------------------

export function RealtimeProviders({ token, children }: { token: string; children: ReactNode }) {
  return (
    <SocketProvider token={token}>
      <NotificationProvider>{children}</NotificationProvider>
    </SocketProvider>
  );
}
```

The `"use client"` directive at the top is what makes this whole module a Client Component boundary — everything defined in this file (both providers and both hooks) can freely use state, effects, and the browser-only socket instance. The Server Component layout in §5 never touches any of that directly; it only passes `token` in as a prop.

---

## 8. Consuming it in a page or component

Any Client Component under `app/(authed)/` can use `useNotifications()` directly, since it's rendering inside the provider tree established by the layout:

```tsx
// components/NotificationBell.tsx
"use client";

import { useNotifications } from "@/realtime/RealtimeProviders";

export function NotificationBell() {
  const { unreadCount } = useNotifications();
  return <BellIcon badgeCount={unreadCount} />;
}
```

Note the `"use client"` here too — a component that calls a hook (`useContext` under the hood) must be a Client Component itself, even though it's rendering inside a client subtree. A default (Server Component) page under `(authed)/` can still render `<NotificationBell />` as a child without issue; it just can't call `useNotifications()` itself.

What each notification actually *means*, and how it's rendered per type, is deliberately left out here — that's the Notifications module's (M11) content, not this plumbing layer's concern.

---

## 9. Reconnection: resync, don't assume nothing was missed

The socket push is a convenience, not the source of truth (the backend doc makes the same point from the other side) — the real notification history always lives behind `GET /notifications`. On reconnect, refetch rather than trusting the gap was empty. Add this inside `SocketProvider`'s effect in §7, or as its own small effect in a component that has access to `useSocket()`:

```tsx
useEffect(() => {
  const { socket } = useSocket();
  if (!socket) return;

  const onReconnect = () => {
    // call whatever already fetches notification history —
    // e.g. a React Query invalidation, or a server action re-fetch
  };

  socket.io.on("reconnect", onReconnect);
  return () => {
    socket.io.off("reconnect", onReconnect);
  };
}, []);
```

The same principle applies to any other feature built on this connection later (the dispute chat included): treat a live event as "something changed, go check," never as the only copy of the truth.

---

## 10. Verification

- Visit a route under `(authed)/` while logged out — confirm the Server Component layout redirects to `/login` and no socket connection is ever attempted (check the network tab, not just the UI).
- Visit `/api/socket-token` (or wherever `mintSocketToken` is exposed, if pulled into a Route Handler for reuse) while unauthenticated — confirm it rejects rather than minting a token for no one.
- Log in, land on an authed route, confirm the socket connects (`connected` becomes `true`).
- Trigger a test emit from the backend (`emitToUser(userId, "notification", {...})`) and confirm `unreadCount` increments with no page refresh.
- Kill and restart the local backend, confirm the client reconnects on its own and the reconnect handler (§9) fires.
- Let the 5-minute token (§6) expire while the tab stays open on an authed route and confirm the reconnection behavior is acceptable — at minimum, document that a full page navigation remints a fresh token via the layout; a token refreshed without a navigation is a nice-to-have, not required for v1.
