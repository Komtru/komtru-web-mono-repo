// The contract between a Komtru client and this gateway: four event names and the shape of what
// travels with them.
//
// These schemas check *shape* only. Whether `{ prefix: 'user', id: '<somebody>' }` names a room the
// caller may join is rooms.ts's question, answered by the handler — because a well-formed request
// for a forbidden room deserves `{ joined: false }` and a malformed one deserves the same answer
// for a different reason, and conflating the two makes the client's bug look like an authorisation
// decision.
import { z } from 'zod';

/** What a client may send. Anything else is ignored: Socket.IO has no 404. */
export const CLIENT_EVENTS = {
  joinRoom: 'room:join',
  leaveRoom: 'room:leave',
  /**
   * A fresh access token. The client's HTTP layer already refreshes every few minutes; forwarding
   * the new token here is what keeps a long-lived socket's authorisation as current as a request's
   * (see services/revalidate.ts).
   */
  token: 'auth:token',
} as const;

/** What the gateway sends about the connection itself. Domain events are each module's own. */
export const SERVER_EVENTS = {
  /** "Your token has lapsed; send a fresh one or you will be disconnected." */
  refreshRequired: 'auth:refresh',
  /** "Your session is gone." Carries the same `AuthFailure` code the HTTP 401 would. */
  revoked: 'auth:revoked',
} as const;

export const roomRequestSchema = z.object({ prefix: z.string(), id: z.string() });
export type RoomRequest = z.output<typeof roomRequestSchema>;

export const tokenRequestSchema = z.object({ token: z.string().min(1) });

/** Why a join was refused. `FORBIDDEN` is an authorizer's answer; `INVALID_ROOM` is the name's. */
export type JoinRefusal = 'INVALID_ROOM' | 'FORBIDDEN';

export interface JoinAck {
  joined: boolean;
  reason?: JoinRefusal;
}
