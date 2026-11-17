// The invariants behind a phone-number change (F-045, SP-M05), under concurrency. Skipped unless KOMTRU_INFRA_TESTS=1.
//
// The step-up is stubbed here and only here: it is proven over HTTP in `phone-change.routes.int.test.ts`, and a real one
// issues one proof per user at a time, which would stop two starts from ever running at once, which is the case under test.
import { describe, expect, it, vi } from 'vitest';
import { resolveDestination } from '../../../../src/modules/notify/services/recipients.service.js';
import { attachPhone, markPhoneVerified } from '../../../../src/modules/identity/services/contact.service.js';
import {
  confirmCurrentPhone,
  startPhoneChange,
  type PhoneChangeDeps,
} from '../../../../src/modules/identity/services/phone-change.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { mfaDeps, seedUser } from '../support.js';

vi.mock('../../../../src/modules/identity/services/step-up.service.js', () => ({
  requireStepUp: () => Promise.resolve(),
}));

const OLD = '+2348032214471';
const VICTIM = '+2349051182299';
const ATTACKER = '+2349051182200';

describe.runIf(infraEnabled)('phone change under concurrency', () => {
  const t = useTestDatabase();
  const deps = (): PhoneChangeDeps => ({ ...mfaDeps(), db: t.db() });

  const member = async () => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const attached = await attachPhone(tx, { userId, phone: OLD, makePrimary: true });
      await markPhoneVerified(tx, { userId, phoneId: attached.phoneId });
    });
    return userId;
  };
  const caller = (userId: string) => ({ userId, ip: null, userAgent: null });

  const pending = async (userId: string) =>
    (
      await t
        .owner()
        .query<{ id: string; phone_e164: string }>(
          `SELECT id, phone_e164 FROM identity.user_phones WHERE user_id = $1 AND change_state = 'PENDING'`,
          [userId],
        )
    ).rows;

  it('leaves exactly one pending number when two starts race, and the code can only be proved for that one', async () => {
    const userId = await member();
    const started = await Promise.all([
      startPhoneChange(deps(), { ...caller(userId), newPhone: VICTIM, stepUpToken: undefined }),
      startPhoneChange(deps(), { ...caller(userId), newPhone: ATTACKER, stepUpToken: undefined }),
    ]);
    expect(started.every((r) => r.outcome === 'STARTED')).toBe(true);

    // The exploit: two pending rows, the code for the one proved delivered to the other's handset.
    const rows = await pending(userId);
    expect(rows).toHaveLength(1);
    const survivor = rows[0];
    const ids = started.flatMap((r) =>
      r.outcome === 'STARTED' ? [{ changeId: r.changeId, challengeId: r.challengeId }] : [],
    );
    const loser = ids.find((i) => i.changeId !== survivor?.id);
    const winner = ids.find((i) => i.changeId === survivor?.id);

    // Notify's one answer for "where does the new number's code go" is the number that is being proved.
    expect((await resolveDestination(t.db(), userId, 'SMS', { phoneTarget: 'PENDING' }))?.address).toEqual([
      survivor?.phone_e164,
    ]);

    // The losing start's change no longer exists, so its code proves nothing and moves nothing on.
    const { rows: codes } = await t
      .app()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
      );
    const codeOf = (challengeId?: string) =>
      codes.map((c) => c.payload).find((p) => p.challengeId === challengeId)?.code ?? '';
    const refused = await confirmCurrentPhone(deps(), {
      ...caller(userId),
      changeId: loser?.changeId ?? '',
      challengeId: loser?.challengeId ?? '',
      code: codeOf(loser?.challengeId),
    });
    expect(refused.outcome).toBe('UNKNOWN');
    // And the survivor's own code still works and goes on to its own number only.
    const ok = await confirmCurrentPhone(deps(), {
      ...caller(userId),
      changeId: winner?.changeId ?? '',
      challengeId: winner?.challengeId ?? '',
      code: codeOf(winner?.challengeId),
    });
    expect(ok.outcome).toBe('CODE_SENT');
  });

  it('holds the same invariant in the database if the lock is ever lost: a second pending insert is refused', async () => {
    const userId = await member();
    const insert = (phone: string) =>
      t
        .owner()
        .query(
          `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, change_state) VALUES ($1, $2, 'NG', false, 'PENDING')`,
          [userId, phone],
        );
    const results = await Promise.allSettled([insert(VICTIM), insert(ATTACKER)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await pending(userId)).toHaveLength(1);
  });

  it('serialises many starts on one account to one pending number', async () => {
    const userId = await member();
    const numbers = [
      '+2349051182201',
      '+2349051182202',
      '+2349051182203',
      '+2349051182204',
      '+2349051182205',
    ];
    await Promise.all(
      numbers.map((newPhone) =>
        startPhoneChange(deps(), { ...caller(userId), newPhone, stepUpToken: undefined }),
      ),
    );
    expect(await pending(userId)).toHaveLength(1);
  });
});
