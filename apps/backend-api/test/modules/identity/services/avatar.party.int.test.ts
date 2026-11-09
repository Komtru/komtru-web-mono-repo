// T-041: the avatar on a PartyCard (M1 D7) - signed at lookup time through `PartyPorts.enrich`, and
// equivalent in signing work for a miss, per T-035's rule. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  avatarEnrichment,
  type AvatarPorts,
} from '../../../../src/modules/identity/services/avatar.service.js';
import { lookupParty, suggestParties } from '../../../../src/modules/identity/services/party.service.js';
import { skeleton } from '../../../../src/modules/identity/domain/username/skeleton.js';
import { NO_LOOKUP_BUDGET } from '../../../../src/modules/identity/infrastructure/redis/lookup-budget.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser } from '../infrastructure/postgres/support.js';
import { testLogger } from '../support.js';

const FILE = '0190b0a0-0000-7000-8000-0000000000f1';

describe.runIf(infraEnabled)('avatars on party cards (T-041)', () => {
  const t = useTestDatabase();

  const setup = async () => {
    const signed: string[] = [];
    const ports: AvatarPorts = {
      findFile: () => Promise.resolve(undefined),
      signUrl: (fileId) => {
        signed.push(fileId);
        return Promise.resolve(`https://cdn.test/${fileId}?sig=abc`);
      },
      tombstone: () => Promise.resolve(),
    };
    const deps = {
      db: t.db(),
      budget: NO_LOOKUP_BUDGET,
      enrich: avatarEnrichment({ db: t.db(), logger: testLogger, ports }),
    };
    const caller = await insertUser(t.owner(), { status: 'ACTIVE', verification_level: 'CONTACT_VERIFIED' });
    const party = async (username: string, avatar: string | null) => {
      const userId = await insertUser(t.owner(), {
        status: 'ACTIVE',
        verification_level: 'CONTACT_VERIFIED',
        username,
        username_skeleton: skeleton(username),
      });
      await t
        .owner()
        .query(`INSERT INTO identity.user_profiles (user_id, avatar_file_id) VALUES ($1, $2)`, [
          userId,
          avatar,
        ]);
      return userId;
    };
    const lookup = (canonical: string) =>
      lookupParty(deps, {
        actorUserId: caller,
        ip: '198.51.100.7',
        key: { channel: 'USERNAME', canonical },
      });
    return { signed, deps, caller, party, lookup };
  };

  it('puts a freshly signed url on the card, and leaves the other enrichment at its defaults', async () => {
    const { party, lookup, signed } = await setup();
    await party('janedoe', FILE);

    const result = await lookup('janedoe');

    expect(result).toMatchObject({
      found: true,
      party: { avatarUrl: `https://cdn.test/${FILE}?sig=abc`, completedTrades: 0, merchantName: null },
    });
    await lookup('janedoe');
    expect(signed.filter((id) => id === FILE)).toHaveLength(2);
  });

  it('is null for a party with no avatar', async () => {
    const { party, lookup } = await setup();
    await party('janedoe', null);
    expect(await lookup('janedoe')).toMatchObject({ found: true, party: { avatarUrl: null } });
  });

  it('does the same signing work for a miss as for a hit with no avatar', async () => {
    const { party, lookup, signed } = await setup();
    await party('janedoe', null);

    signed.length = 0;
    await lookup('janedoe');
    const hitCalls = [...signed];
    signed.length = 0;
    await lookup('nobodyhere');

    expect(signed).toEqual(hitCalls);
    expect(signed).toHaveLength(1);
  });

  it('puts avatars on typeahead results', async () => {
    const { party, deps, caller } = await setup();
    await party('janeaa', FILE);
    await party('janebb', null);

    const { parties } = await suggestParties(deps, { actorUserId: caller, prefix: 'jane' });

    expect(parties.map((p) => p.avatarUrl).sort()).toEqual([`https://cdn.test/${FILE}?sig=abc`, null].sort());
  });
});
