// M1 §17 "Username", in full, plus the §6.4 change policy. Against the real database, because most
// of these rules are the database's: the unique index on username_skeleton, the format CHECK with
// its ::text cast, and the history rows that outlive the handle.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../src/platform/errors.js';
import { seedIdentityCatalogue } from '../../../../src/modules/identity/infrastructure/postgres/seed.js';
import {
  changeUsername,
  checkUsernameAvailability,
  claimUsername,
  listUsernameHistory,
  tombstoneUsername,
  type UsernameServiceDeps,
} from '../../../../src/modules/identity/services/username.service.js';
import { generatePublicId } from '../../../../src/platform/identifiers.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser } from '../infrastructure/postgres/support.js';

const DAY = 24 * 60 * 60 * 1000;

const problem = async (run: Promise<unknown>): Promise<{ status: number; detail: string }> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, detail: error.detail ?? '' };
    throw error;
  }
  throw new Error('expected the call to be rejected');
};

const expectConflict = async (run: Promise<unknown>, mentioning: string): Promise<void> => {
  const failure = await problem(run);
  expect(failure.status).toBe(409);
  expect(failure.detail).toContain(mentioning);
};

describe.runIf(infraEnabled)('username service', () => {
  const t = useTestDatabase();

  /** A clock the test moves, so the 30/90-day windows are exercised without waiting. */
  const clockAt = (start = new Date('2026-10-05T12:00:00Z')) => {
    let current = start;
    return {
      now: () => current,
      advanceDays: (days: number) => {
        current = new Date(current.getTime() + days * DAY);
      },
    };
  };

  const deps = (over: Partial<UsernameServiceDeps> = {}): UsernameServiceDeps => ({
    db: t.db(),
    ...over,
  });

  const seeded = async (): Promise<void> => {
    await seedIdentityCatalogue(t.db());
  };

  const usernameOf = async (pool: pg.Pool, userId: string) => {
    const { rows } = await pool.query<{ username: string; username_skeleton: string; count: number }>(
      'SELECT username, username_skeleton, username_change_count AS count FROM identity.users WHERE id = $1',
      [userId],
    );
    return rows[0];
  };

  it('claims a free handle, folds it, and records history', async () => {
    await seeded();
    const user = await insertUser(t.app());
    const result = await claimUsername(deps(), { userId: user, username: 'DellStore_NG' });

    expect(result).toEqual({ username: 'dellstore_ng' });
    expect(await usernameOf(t.app(), user)).toMatchObject({
      username: 'dellstore_ng',
      username_skeleton: 'delstoreng',
      // Zero, not one: §6.4 caps *changes*, and the first claim is not a change. Counting it would
      // spend one of the user's three before they had ever renamed.
      count: 0,
    });
    const history = await listUsernameHistory(deps(), user);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ username: 'dellstore_ng', releasedAt: null });
  });

  it('rejects the §17 collision set once the first handle is claimed', async () => {
    await seeded();
    const owner = await insertUser(t.app());
    await claimUsername(deps(), { userId: owner, username: 'dellstore' });

    for (const attempt of ['dell.store', 'dellst0re', 'de11st0re', 'dellstoree']) {
      const other = await insertUser(t.app());
      const result = await checkUsernameAvailability(deps(), attempt);
      expect(result).toMatchObject({ available: false, reason: 'CONFUSABLE' });
      expect(await problem(claimUsername(deps(), { userId: other, username: attempt }))).toMatchObject({
        status: 409,
      });
    }
    // And the handle itself reads as taken rather than merely confusable.
    expect(await checkUsernameAvailability(deps(), 'dellstore')).toMatchObject({
      available: false,
      reason: 'TAKEN',
    });
  });

  // The CHECK casts to text and so fires before the unique index: SQLSTATE 23514, not 23505. A
  // service that mapped every rejected write to "taken" would tell a user their own free handle is
  // gone. The application regex stops it first; this proves the mapping if it ever does not.
  it('reports a mixed-case handle as a format problem, not as taken', async () => {
    await seeded();
    const user = await insertUser(t.app());
    const result = await checkUsernameAvailability(deps(), 'JaneDoe');
    expect(result).toMatchObject({ available: true, username: 'janedoe' });

    const direct = t
      .app()
      .query("UPDATE identity.users SET username = 'JaneDoe', username_skeleton = 'janedoe' WHERE id = $1", [
        user,
      ]);
    await expect(direct).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects reserved words and their confusable variants', async () => {
    await seeded();
    // `3scr0w` is not in this list: a handle cannot start with a digit, so it never reaches the
    // reserved check. `e5cr0w` is the version an attacker can actually claim.
    for (const attempt of ['admin', 'adm1n', 'a.d.m.i.n', 'escrow', 'e5cr0w', 'paystack', 'fiutterwave'])
      expect(await checkUsernameAvailability(deps(), attempt)).toMatchObject({
        available: false,
        reason: 'RESERVED',
      });
  });

  it('rejects a handle carrying a blocked substring', async () => {
    await seeded();
    for (const attempt of ['komtru_deals', 'my.official.support'])
      expect(await checkUsernameAvailability(deps(), attempt)).toMatchObject({
        available: false,
        reason: 'BLOCKED_TERM',
      });
  });

  it('rejects a malformed handle with the rule that fired', async () => {
    await seeded();
    expect(await checkUsernameAvailability(deps(), 'ab')).toMatchObject({
      available: false,
      reason: 'INVALID',
      problem: 'TOO_SHORT',
    });
    expect(await checkUsernameAvailability(deps(), '1store')).toMatchObject({
      reason: 'INVALID',
      problem: 'INVALID_FORMAT',
    });
  });

  it('enforces the 30-day cooldown', async () => {
    await seeded();
    const clock = clockAt();
    const user = await insertUser(t.app());
    await claimUsername(deps({ now: clock.now }), { userId: user, username: 'firsthandle' });

    clock.advanceDays(29);
    await expectConflict(
      changeUsername(deps({ now: clock.now }), {
        userId: user,
        username: 'secondhandle',
        reason: 'rebrand',
      }),
      '30 days',
    );

    clock.advanceDays(2);
    await expect(
      changeUsername(deps({ now: clock.now }), {
        userId: user,
        username: 'secondhandle',
        reason: 'rebrand',
      }),
    ).resolves.toMatchObject({ username: 'secondhandle', previous: 'firsthandle' });
  });

  it('enforces the 3-change lifetime cap', async () => {
    await seeded();
    const clock = clockAt();
    const user = await insertUser(t.app());
    await claimUsername(deps({ now: clock.now }), { userId: user, username: 'handlezero' });

    for (const handle of ['handleone', 'handletwo', 'handlethree']) {
      clock.advanceDays(31);
      await changeUsername(deps({ now: clock.now }), { userId: user, username: handle, reason: 'r' });
    }

    clock.advanceDays(31);
    await expectConflict(
      changeUsername(deps({ now: clock.now }), {
        userId: user,
        username: 'handlefour',
        reason: 'r',
      }),
      'support',
    );
  });

  it('blocks a change while a trade is in flight', async () => {
    await seeded();
    const clock = clockAt();
    const user = await insertUser(t.app());
    await claimUsername(deps({ now: clock.now }), { userId: user, username: 'tradinghandle' });
    clock.advanceDays(31);

    await expectConflict(
      changeUsername(deps({ now: clock.now, hasActiveTrade: () => Promise.resolve(true) }), {
        userId: user,
        username: 'newhandle',
        reason: 'r',
      }),
      'trade',
    );
  });

  it('requires support approval for a verified seller with completed trades', async () => {
    await seeded();
    const clock = clockAt();
    const user = await insertUser(t.app(), { verification_level: 'IDENTITY_VERIFIED' });
    await claimUsername(deps({ now: clock.now }), { userId: user, username: 'verifiedshop' });
    clock.advanceDays(31);

    const withTrades = deps({ now: clock.now, hasCompletedTrades: () => Promise.resolve(true) });
    await expectConflict(
      changeUsername(withTrades, { userId: user, username: 'newshop', reason: 'r' }),
      'support',
    );

    // A forced change by staff (T-037's username.force_change) is not subject to any of this.
    await expect(
      changeUsername(withTrades, { userId: user, username: 'newshop', reason: 'r', forced: true }),
    ).resolves.toMatchObject({ username: 'newshop' });
  });

  it('quarantines the released handle for 90 days against a third party', async () => {
    await seeded();
    const clock = clockAt();
    const owner = await insertUser(t.app());
    const stranger = await insertUser(t.app());
    await claimUsername(deps({ now: clock.now }), { userId: owner, username: 'oldhandle' });
    clock.advanceDays(31);
    await changeUsername(deps({ now: clock.now }), {
      userId: owner,
      username: 'newhandle',
      reason: 'rebrand',
    });

    clock.advanceDays(89);
    expect(await checkUsernameAvailability(deps({ now: clock.now }), 'oldhandle')).toMatchObject({
      available: false,
      reason: 'QUARANTINED',
    });
    expect(
      await problem(claimUsername(deps({ now: clock.now }), { userId: stranger, username: 'oldhandle' })),
    ).toMatchObject({ status: 409 });

    clock.advanceDays(2);
    await expect(
      claimUsername(deps({ now: clock.now }), { userId: stranger, username: 'oldhandle' }),
    ).resolves.toMatchObject({ username: 'oldhandle' });
  });

  it('lets the original owner reclaim within 30 days and not after', async () => {
    await seeded();
    const clock = clockAt();
    const owner = await insertUser(t.app());
    await claimUsername(deps({ now: clock.now }), { userId: owner, username: 'oldhandle' });
    clock.advanceDays(31);
    await changeUsername(deps({ now: clock.now }), {
      userId: owner,
      username: 'newhandle',
      reason: 'rebrand',
    });

    clock.advanceDays(29);
    expect(
      await checkUsernameAvailability(deps({ now: clock.now }), 'oldhandle', { forUserId: owner }),
    ).toMatchObject({ available: true });

    clock.advanceDays(2);
    expect(
      await checkUsernameAvailability(deps({ now: clock.now }), 'oldhandle', { forUserId: owner }),
    ).toMatchObject({ available: false, reason: 'QUARANTINED' });
  });

  it('preserves the historical username after a change', async () => {
    await seeded();
    const clock = clockAt();
    const user = await insertUser(t.app());
    await claimUsername(deps({ now: clock.now }), { userId: user, username: 'beforehandle' });
    clock.advanceDays(31);
    await changeUsername(deps({ now: clock.now }), {
      userId: user,
      username: 'afterhandle',
      reason: 'rebrand',
    });

    const history = await listUsernameHistory(deps(), user);
    expect(history.map((entry) => entry.username)).toEqual(['afterhandle', 'beforehandle']);
    expect(history[1]).toMatchObject({ reason: 'rebrand' });
    expect(history[1]?.releasedAt).not.toBeNull();
    expect(history[1]?.quarantineUntil).not.toBeNull();
  });

  it('publishes identity.username.claimed and .changed into the outbox', async () => {
    await seeded();
    const clock = clockAt();
    const user = await insertUser(t.app());
    await claimUsername(deps({ now: clock.now }), { userId: user, username: 'eventhandle' });
    clock.advanceDays(31);
    await changeUsername(deps({ now: clock.now }), {
      userId: user,
      username: 'eventhandletwo',
      reason: 'rebrand',
    });

    const { rows } = await t
      .app()
      .query<{ event_type: string; payload: Record<string, unknown> }>(
        'SELECT event_type, payload FROM platform.outbox ORDER BY occurred_at',
      );
    expect(rows.map((row) => row.event_type)).toEqual([
      'identity.username.claimed',
      'identity.username.changed',
    ]);
    expect(rows[1]?.payload).toMatchObject({ from: 'eventhandle', to: 'eventhandletwo' });
  });

  it('rolls the event back with the write it describes', async () => {
    await seeded();
    const owner = await insertUser(t.app());
    const loser = await insertUser(t.app());
    await claimUsername(deps(), { userId: owner, username: 'contested' });
    await problem(claimUsername(deps(), { userId: loser, username: 'contested' }));

    const { rows } = await t.app().query<{ n: number }>('SELECT count(*)::int AS n FROM platform.outbox');
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses a second claim from a user who already has a handle', async () => {
    await seeded();
    const user = await insertUser(t.app());
    await claimUsername(deps(), { userId: user, username: 'onlyhandle' });
    await expectConflict(claimUsername(deps(), { userId: user, username: 'otherhandle' }), 'already');
  });

  // M1 §15: the tombstone handle is generated through skeleton() like any other, so it has to
  // survive the same unique index at scale.
  it('generates an anonymisation tombstone that inserts cleanly with 10,000 users present', async () => {
    await seeded();
    await t.owner().query(
      `INSERT INTO identity.users (public_id, username, username_skeleton)
       SELECT 'KMT-U-BULK' || g, 'bulkuser' || g, 'bulkuser' || g FROM generate_series(1, 10000) g`,
    );
    const user = await insertUser(t.app(), { public_id: generatePublicId() });
    await claimUsername(deps(), { userId: user, username: 'leavinghandle' });

    const result = await tombstoneUsername(deps(), { userId: user });
    expect(result.username).toMatch(/^deleted_[a-z0-9]{8}$/);
    expect(await usernameOf(t.app(), user)).toMatchObject({ username: result.username });

    const history = await listUsernameHistory(deps(), user);
    expect(history.some((entry) => entry.username === 'leavinghandle')).toBe(true);
  });

  it('suggests alternatives when the handle is taken, none of which are taken themselves', async () => {
    await seeded();
    const owner = await insertUser(t.app());
    await claimUsername(deps(), { userId: owner, username: 'dellstore' });
    const taker = await insertUser(t.app());
    await claimUsername(deps(), { userId: taker, username: 'dellstore_ng' });

    const result = await checkUsernameAvailability(deps(), 'dellstore');
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions).not.toContain('dellstore_ng');
    for (const suggestion of result.suggestions)
      expect(await checkUsernameAvailability(deps(), suggestion)).toMatchObject({ available: true });
  });

  it('offers no suggestions when the handle is free', async () => {
    await seeded();
    expect(await checkUsernameAvailability(deps(), 'freehandle')).toEqual({
      username: 'freehandle',
      available: true,
      suggestions: [],
    });
  });
});
