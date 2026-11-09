// Who may join `trade:<code>` (T-068). This is the one place a party could see another's trade, so
// every refusal is tested, and the whole file is run against the real authorizer registry: a path
// that denies by accident (an unregistered prefix) would otherwise look like one that denies by rule.
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../../src/platform/http/principal.js';
import { createAuthorizerRegistry } from '../../../../src/modules/socket/services/authorizers.js';
import {
  TRADE_ROOM_PREFIX,
  tradeRoomAuthorizer,
  type TradeParties,
} from '../../../../src/modules/trades/infrastructure/realtime.js';
import { testLogger } from '../../identity/support.js';

const BUYER = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f0001';
const SELLER = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f0002';
const STRANGER = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f0003';
const CODE = 'KMT-7398512-NG';

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  userId: STRANGER,
  publicId: 'u_x',
  sessionId: 's',
  familyId: 'f',
  scope: 'CONSUMER',
  status: 'ACTIVE',
  sessionsEpoch: 0,
  amr: ['pwd'],
  roles: [],
  permissions: new Set<string>(),
  companyMembership: null,
  ...overrides,
});

const trade = (over: Partial<TradeParties> = {}): TradeParties => ({
  buyerUserId: BUYER,
  sellerUserId: SELLER,
  status: 'FUNDED',
  previousStatus: 'PENDING_PAYMENT',
  initiatorUserId: BUYER,
  ...over,
});

const setup = (parties: Record<string, TradeParties> = { [CODE]: trade() }) => {
  const registry = createAuthorizerRegistry(testLogger);
  const lookup = vi.fn((code: string) => Promise.resolve(parties[code]));
  registry.register(TRADE_ROOM_PREFIX, tradeRoomAuthorizer({ parties: lookup }));
  const join = (p: Principal, id = CODE) =>
    registry.authorize({ userId: p.userId, scope: p.scope, principal: p, prefix: TRADE_ROOM_PREFIX, id });
  return { join, lookup };
};

describe('trade room authorisation', () => {
  describe('a proposal the counterparty may not know about yet', () => {
    it.each([
      ['held for review', { status: 'UNDER_PROPOSAL_REVIEW' as const, previousStatus: 'DRAFT' as const }],
      [
        'turned back by review',
        { status: 'REJECTED' as const, previousStatus: 'UNDER_PROPOSAL_REVIEW' as const },
      ],
      [
        'withdrawn while held',
        { status: 'CANCELLED' as const, previousStatus: 'UNDER_PROPOSAL_REVIEW' as const },
      ],
    ])('refuses the counterparty a trade %s, and still admits the proposer', async (_name, state) => {
      const { join } = setup({ [CODE]: trade({ ...state, initiatorUserId: BUYER }) });
      expect(await join(principal({ userId: SELLER }))).toBe(false);
      expect(await join(principal({ userId: BUYER }))).toBe(true);
    });

    it('admits the counterparty to a trade that was cancelled in the ordinary way', async () => {
      const { join } = setup({
        [CODE]: trade({ status: 'CANCELLED', previousStatus: 'AWAITING_ACCEPTANCE' }),
      });
      expect(await join(principal({ userId: SELLER }))).toBe(true);
    });
  });

  it('admits the buyer and the seller', async () => {
    const { join } = setup();
    expect(await join(principal({ userId: BUYER }))).toBe(true);
    expect(await join(principal({ userId: SELLER }))).toBe(true);
  });

  it('refuses a signed-in user who is not a party', async () => {
    const { join } = setup();
    expect(await join(principal({ userId: STRANGER }))).toBe(false);
  });

  it('refuses everyone on a trade whose counterparty has not claimed it yet', async () => {
    const { join } = setup({ [CODE]: trade({ sellerUserId: null }) });
    expect(await join(principal({ userId: STRANGER }))).toBe(false);
    expect(await join(principal({ userId: SELLER }))).toBe(false);
    expect(await join(principal({ userId: BUYER }))).toBe(true);
  });

  it('refuses a trade that does not exist, exactly as it refuses one that is not theirs', async () => {
    const { join } = setup();
    expect(await join(principal({ userId: BUYER }), 'KMT-0000000-NG')).toBe(false);
  });

  it('refuses a malformed code without asking the database', async () => {
    const { join, lookup } = setup();
    expect(await join(principal({ userId: BUYER }), 'not-a-trade-code')).toBe(false);
    // Not canonical: the push goes to the canonical room, so an alias is never a room anyone is in.
    expect(await join(principal({ userId: BUYER }), 'kmt-7398512-ng')).toBe(false);
    expect(await join(principal({ userId: BUYER }), 'KMT-7398512')).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('admits staff holding trade.view_all and refuses staff without it', async () => {
    const { join } = setup();
    const staff = (permissions: string[]) =>
      principal({ scope: 'STAFF', roles: ['SUPPORT'], permissions: new Set(permissions) });
    expect(await join(staff(['trade.view_all']))).toBe(true);
    expect(await join(staff(['trade.view', 'cases.view']))).toBe(false);
    expect(await join(staff([]))).toBe(false);
    // ...but an unknown trade is refused even for staff who may see every real one.
    expect(await join(staff(['trade.view_all']), 'KMT-0000000-NG')).toBe(false);
  });

  it('does not let trade.view_all on a non-staff session open the room', async () => {
    const { join } = setup();
    const permissions = new Set(['trade.view_all']);
    expect(await join(principal({ scope: 'CONSUMER', permissions }))).toBe(false);
    expect(await join(principal({ scope: 'LOGISTICS', permissions }))).toBe(false);
  });

  it('does not admit a party who signed in under a staff or logistics scope', async () => {
    const { join } = setup();
    expect(await join(principal({ userId: BUYER, scope: 'STAFF' }))).toBe(false);
    expect(await join(principal({ userId: SELLER, scope: 'LOGISTICS' }))).toBe(false);
  });

  it('fails closed when the lookup throws', async () => {
    const registry = createAuthorizerRegistry(testLogger);
    registry.register(
      TRADE_ROOM_PREFIX,
      tradeRoomAuthorizer({ parties: () => Promise.reject(new Error('postgres is away')) }),
    );
    const p = principal({ userId: BUYER });
    expect(
      await registry.authorize({ userId: p.userId, scope: p.scope, principal: p, prefix: 'trade', id: CODE }),
    ).toBe(false);
  });
});
