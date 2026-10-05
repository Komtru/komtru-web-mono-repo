# Kumtru — Backend Socket Module Setup

**Setup guide** · 22 August 2026

---

## Scope

This document covers only the plumbing: how a real-time socket layer gets wired into the backend, authenticated, and made available to the rest of the modular monolith. It deliberately does not cover any specific use case — not the dispute mediation room's join rules, not what a notification payload looks like, not chat message persistence. Those live in their owning modules (Disputes, Notifications) and consume the gateway this document sets up. If you're looking for "how does the dispute chat room decide who can join," that's a Disputes-module concern layered on top of the generic `authorizeAndJoin` hook described in §7 — not part of this setup.

---

## 1. What this module is responsible for

One Socket.IO server, shared by the whole backend, that:

- authenticates a connection using the same identity the HTTP API already trusts (no second auth system)
- automatically places every connected user into a personal room, so "notify this user" is a one-line broadcast from anywhere else in the backend
- exposes a small, generic API for other backend modules to (a) emit an event to a user/room and (b) register an authorization check for a feature-specific room, without those modules needing to know anything about Socket.IO internals
- scales across more than one running app instance via Redis, the same Redis already provisioned for BullMQ (Module 0 §4/§5)

Everything else — what events exist, what's in their payloads, who's allowed in which feature-specific room — belongs to whichever module needs it.

---

## 2. Dependencies

```bash
npm install socket.io @socket.io/redis-adapter ioredis
```

- `socket.io` — the server itself
- `@socket.io/redis-adapter` — cross-instance broadcast, so a message published from app instance A reaches a socket connected to instance B
- `ioredis` — Redis client used to create the two connections the adapter needs (pub + sub)

---

## 3. Environment variables

```
SOCKET_REDIS_URL=            # reuse the same Redis URL as BullMQ (Module 0) unless isolating instances
SOCKET_REDIS_KEY_PREFIX=kumtru:sock:   # keeps pub/sub keys separate from BullMQ's job keys on the same Redis
SOCKET_CORS_ORIGINS=         # comma-separated list of allowed client origins (web app, admin portal, mobile if applicable)
SOCKET_AUTH_TOKEN_SECRET=    # same JWT/session-signing secret M1/M14's HTTP auth already uses — do not create a second secret
```

Reusing the existing Redis instance is a deliberate MVP-cost choice, consistent with Module 0's posture elsewhere — a distinct key prefix is enough to keep BullMQ's job data and the socket adapter's pub/sub channels from colliding on the same instance.

---

## 4. Server bootstrap

Socket.IO attaches to the same underlying `http.Server` your HTTP framework already creates — it doesn't care whether that's Express, Fastify, or anything else.

```ts
// socket/server.ts
import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";

export function createSocketServer(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (process.env.SOCKET_CORS_ORIGINS ?? "").split(","),
      credentials: true,
    },
  });

  return io;
}
```

```ts
// app bootstrap (wherever the HTTP server is created today)
const httpServer = http.createServer(app);
const io = createSocketServer(httpServer);
attachRedisAdapter(io);      // §5
attachAuthMiddleware(io);    // §6
attachConnectionHandler(io); // §7/§8

httpServer.listen(PORT);
```

---

## 5. Redis adapter wiring (horizontal scaling)

```ts
// socket/redisAdapter.ts
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server as SocketIOServer } from "socket.io";

export function attachRedisAdapter(io: SocketIOServer) {
  const keyPrefix = process.env.SOCKET_REDIS_KEY_PREFIX ?? "kumtru:sock:";

  const pubClient = new Redis(process.env.SOCKET_REDIS_URL!, { keyPrefix });
  const subClient = pubClient.duplicate();

  io.adapter(createAdapter(pubClient, subClient));
}
```

Without this, running more than one app instance behind a load balancer means a message published on instance A never reaches a socket that happened to land on instance B. With it, `io.to("user:123").emit(...)` works correctly no matter which instance the target socket is connected to.

---

## 6. Authentication middleware

The socket handshake is authenticated with the exact same token/session mechanism the HTTP API already trusts — this is not a second identity system.

```ts
// socket/auth.ts
import jwt from "jsonwebtoken";
import type { Server as SocketIOServer } from "socket.io";

export function attachAuthMiddleware(io: SocketIOServer) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("unauthenticated"));

    try {
      const claims = jwt.verify(token, process.env.SOCKET_AUTH_TOKEN_SECRET!) as {
        sub: string;
        principalType: "CONSUMER" | "STAFF";
      };
      socket.data.userId = claims.sub;
      socket.data.principalType = claims.principalType;
      next();
    } catch {
      next(new Error("invalid_token"));
    }
  });
}
```

Never trust a client-supplied user ID for room membership — always resolve identity server-side from the verified token, as above. `principalType` distinguishes a consumer session (M1) from a staff session (M14), since the two are deliberately separate identity spaces and some feature-specific rooms will only ever admit one of them.

---

## 7. Personal room convention (the piece the frontend depends on)

On successful auth, every socket auto-joins a personal room keyed by identity. This one room is what makes "push a notification to this specific user" a one-liner from anywhere in the backend, and it's the room the frontend's global listener (see the companion frontend doc) subscribes to.

```ts
// socket/connectionHandler.ts
import type { Server as SocketIOServer } from "socket.io";

export function attachConnectionHandler(io: SocketIOServer) {
  io.on("connection", (socket) => {
    const { userId, principalType } = socket.data;
    const personalRoom =
      principalType === "STAFF" ? `admin:${userId}` : `user:${userId}`;

    socket.join(personalRoom);

    // Feature-specific room joins are handled separately — see §8.
  });
}
```

---

## 8. Generic authorized room-join pattern (for future feature rooms)

Other rooms (a dispute mediation room, or anything added later) need their own authorization check — "is this user actually allowed in this room right now" — decided by whichever module owns that feature, not by this one. This module only provides the mechanism: a place to register a check, and a generic event the client uses to request joining.

```ts
// socket/roomAuthorization.ts
type RoomAuthorizer = (params: {
  userId: string;
  principalType: "CONSUMER" | "STAFF";
  roomId: string;
}) => Promise<boolean>;

const authorizers = new Map<string, RoomAuthorizer>();

// Called once at startup by whichever module owns a room type, e.g.:
//   registerRoomAuthorizer("dispute", disputeRoomAuthorizer)
export function registerRoomAuthorizer(roomType: string, authorizer: RoomAuthorizer) {
  authorizers.set(roomType, authorizer);
}

export async function tryJoinRoom(
  socket: import("socket.io").Socket,
  roomType: string,
  roomId: string
) {
  const authorizer = authorizers.get(roomType);
  if (!authorizer) return false;

  const allowed = await authorizer({
    userId: socket.data.userId,
    principalType: socket.data.principalType,
    roomId,
  });

  if (allowed) socket.join(`${roomType}:${roomId}`);
  return allowed;
}
```

```ts
// wired into the connection handler from §7
socket.on("room:join", async ({ roomType, roomId }, ack) => {
  const joined = await tryJoinRoom(socket, roomType, roomId);
  ack?.({ joined });
});
```

A module like Disputes would register its own authorizer at startup — checking a room ID against `disputes.buyer_user_id` / `seller_user_id` / `assigned_reviewer_id`, for example — without this socket module needing to know anything about disputes at all. That authorization logic belongs in the Disputes module's own setup, not here.

---

## 9. Emitting from other backend modules

Every other module already communicates by emitting domain events (Module 0 §4). This gateway is the one place those events, when they need to reach a live client, get turned into a socket push — modules call this, they never touch `io` directly.

```ts
// socket/gateway.ts
import type { Server as SocketIOServer } from "socket.io";

let ioRef: SocketIOServer;

export function initSocketGateway(io: SocketIOServer) {
  ioRef = io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  ioRef.to(`user:${userId}`).emit(event, payload);
}

export function emitToStaff(adminUserId: string, event: string, payload: unknown) {
  ioRef.to(`admin:${adminUserId}`).emit(event, payload);
}

export function emitToRoom(roomType: string, roomId: string, event: string, payload: unknown) {
  ioRef.to(`${roomType}:${roomId}`).emit(event, payload);
}
```

A future Notifications-module delivery adapter, for instance, would call `emitToUser(userId, "notification", payload)` after writing the durable `notifications` row — that adapter's own logic is out of scope here.

---

## 10. Scaling and deployment notes

- Behind an AWS ALB (per Module 0's infra), WebSocket pass-through works natively — no special ALB configuration is required for the protocol itself, but confirm the target group's idle timeout is long enough for a persistent connection (the ALB default of 60s is too short; raise it).
- With the Redis adapter in place (§5), sticky sessions are not strictly required for correctness, since any instance can broadcast to a socket held by any other instance — but enabling them (ALB supports this) reduces unnecessary cross-instance hops and is a reasonable default.
- Socket.IO's client reconnects automatically with backoff by default; no custom reconnection logic is needed on the server.

---

## 11. Local verification

```bash
# minimal smoke test with a plain client, no frontend needed
node -e '
const { io } = require("socket.io-client");
const socket = io("http://localhost:PORT", { auth: { token: "TEST_JWT" } });
socket.on("connect", () => console.log("connected:", socket.id));
socket.on("connect_error", (e) => console.error("auth failed:", e.message));
'
```

Confirm: (1) a valid token connects and lands in its personal room, (2) an invalid/missing token is rejected before `connection` fires, (3) with two app instances running locally against the same Redis, an event emitted from instance A's `emitToUser` reaches a socket connected to instance B.

---

## 12. Security checklist

- Identity is always resolved from the verified token server-side (§6) — never from a client-supplied field.
- Every feature-specific room requires an explicit authorizer (§8); there is no default-allow room type.
- CORS origins are an explicit allowlist (§3), not a wildcard.
- Connection-rate abuse (many rapid reconnects from one client) is a Risk & Fraud (M13) concern to eventually wire a signal into — not handled by this module directly, flagged here so it isn't forgotten.
