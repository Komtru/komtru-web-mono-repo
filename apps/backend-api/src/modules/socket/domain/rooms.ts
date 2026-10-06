// Room names, and the rules that make one unforgeable.
//
// A Socket.IO room is just a string, and every room in this gateway is `<prefix>:<id>`. A personal
// room is a room name too — `user:<uuid>` is where "notify this user" lands — so the moment a
// feature module may register the prefix `user`, a client that asks to join `user:<somebody-else>`
// is asking for another person's inbox and a well-meaning authorizer might say yes. The socket
// setup guide's §8 registry has exactly that hole. This file closes it: the personal prefixes are
// reserved, no authorizer may claim one, and no join request carrying one is ever considered.
//
// The id pattern does the same job one level down. `:` is the separator, so an id allowed to carry
// one lets a client shape a room name of its choosing out of a prefix someone else registered.
import { SESSION_SCOPES, type SessionScope } from '@komtru/shared-types';

/** A feature prefix: lower-case, starts with a letter, no separator, bounded. */
export const ROOM_PREFIX_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** A room id: a uuid, a trade code, a public id. Never a `:`, never unbounded. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `user` plus one per session scope — every prefix this module hands out by itself. Derived from
 * `SESSION_SCOPES` rather than written out, because `scopeRoom` derives its names the same way: a
 * fourth scope would otherwise ship a personal-room prefix a feature module could claim, which is
 * exactly the hole this file exists to close.
 */
export const RESERVED_ROOM_PREFIXES: ReadonlySet<string> = new Set([
  'user',
  ...SESSION_SCOPES.map((scope) => scope.toLowerCase()),
]);

/** Where "notify this user" goes, whatever scope they signed in under. */
export const personalRoom = (userId: string): string => `user:${userId}`;

/** The same user, narrowed to one way of signing in: a staff-only push must not reach their phone. */
export const scopeRoom = (scope: SessionScope, userId: string): string => `${scope.toLowerCase()}:${userId}`;

export const roomsForPrincipal = (principal: { userId: string; scope: SessionScope }): string[] => [
  personalRoom(principal.userId),
  scopeRoom(principal.scope, principal.userId),
];

/** True when `<prefix>:<id>` is a feature room a client may ask to join. */
export const isJoinableRoom = (prefix: string, id: string): boolean =>
  ROOM_PREFIX_PATTERN.test(prefix) && !RESERVED_ROOM_PREFIXES.has(prefix) && ROOM_ID_PATTERN.test(id);

/**
 * Throws rather than returns, because the caller is `registerRoomAuthorizer` at boot: a module
 * claiming a prefix it may not have is a deployment that should not start, not a runtime denial.
 */
export function assertRegisterablePrefix(prefix: string): void {
  if (RESERVED_ROOM_PREFIXES.has(prefix)) {
    throw new Error(`socket: "${prefix}" is a reserved personal-room prefix and cannot be registered`);
  }
  if (!ROOM_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`socket: "${prefix}" is not a valid room prefix (${String(ROOM_PREFIX_PATTERN)})`);
  }
}

/**
 * A feature room's name. Throws on anything a client could not legally join, so a backend caller
 * that passes junk to `emitToRoom` learns about it instead of broadcasting into a room nobody
 * is in — which looks exactly like "the feature is broken" and nothing like "the name was wrong".
 */
export function featureRoom(prefix: string, id: string): string {
  if (!isJoinableRoom(prefix, id)) {
    throw new Error(`socket: "${prefix}:${id}" is not a valid feature room name`);
  }
  return `${prefix}:${id}`;
}
