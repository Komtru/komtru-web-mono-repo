// "Is this user allowed in this room right now?" — asked by the gateway, answered by whichever
// module owns the room type (a trade, a dispute, a hub). This file is only the mechanism.
//
// Default deny, three ways: a prefix nobody registered is refused, an authorizer that throws is
// refused, and an authorizer that rejects is refused. A feature module's bug must never become
// "everyone is welcome", and must never take down the connection it was asked about.
//
// The map is per registry instance rather than module-level, so two gateways in one process — two
// API instances in one integration test — cannot see each other's registrations.
import type { SessionScope } from '@komtru/shared-types';
import type { Logger } from '../../../platform/logger.js';
import type { Principal } from '../../../platform/http/principal.js';
import { assertRegisterablePrefix } from '../domain/rooms.js';

export interface RoomAuthorizerInput {
  userId: string;
  scope: SessionScope;
  /**
   * The whole principal, re-resolved from Postgres at handshake and on every re-validation sweep.
   * An authorizer that needs a role or a permission reads it here and never off the token.
   */
  principal: Principal;
  prefix: string;
  id: string;
}

export type RoomAuthorizer = (input: RoomAuthorizerInput) => boolean | Promise<boolean>;

export interface AuthorizerRegistry {
  /** Called once at start by the module that owns the prefix. A second claim is a boot failure. */
  register: (prefix: string, authorizer: RoomAuthorizer) => void;
  authorize: (input: RoomAuthorizerInput) => Promise<boolean>;
}

export function createAuthorizerRegistry(logger: Logger): AuthorizerRegistry {
  const authorizers = new Map<string, RoomAuthorizer>();

  return {
    register(prefix, authorizer) {
      assertRegisterablePrefix(prefix);
      if (authorizers.has(prefix)) {
        throw new Error(`socket: a room authorizer is already registered for "${prefix}"`);
      }
      authorizers.set(prefix, authorizer);
    },

    async authorize(input) {
      const authorizer = authorizers.get(input.prefix);
      if (!authorizer) return false;
      try {
        return (await authorizer(input)) === true;
      } catch (error) {
        logger.error(
          { err: error, prefix: input.prefix, roomId: input.id, userId: input.userId },
          'socket: a room authorizer failed; denying the join',
        );
        return false;
      }
    },
  };
}
