// The canned platform API and the session seeder, end to end over HTTP and against the app's own sealer.
// No browser and no backend: the stand-in is started on an ephemeral port and the apps' contracts are
// checked by the same schemas the apps parse with.
import { createSessionSealer, subjectDigest } from '@komtru/app-kit';
import { tradeListResponseSchema, viewerFactsSchema } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';

import { checkFixtures } from '../src/standin/contracts.ts';
import {
  comparisonSchema,
  disputeDetailSchema,
  disputeSchema,
  merchantApplicationSchema,
  meSchema,
  tradeViewSchema,
} from '@komtru/api-client';
import { disputesFor, merchantApplicationFor, paymentStatusFor, tradesFor } from '../src/standin/fixtures.ts';
import {
  getInspection,
  paymentStatusSchema,
  payoutAccountSchema,
  tradeStandardSchema,
  verificationStatusSchema,
} from '@komtru/api-client';
import { addressSchema } from '@komtru/shared-types';
import { PERSONAS, type PersonaId, type ScenarioId } from '../src/standin/personas.ts';
import { accessTokenFor, readBearer, readRefreshToken } from '../src/standin/identity.ts';
import { startStandin } from '../src/standin/server.ts';
import { sessionCookiesFor, STANDIN_NOW_MS, STANDIN_SESSION_SECRET } from '../src/standin/session.ts';

describe('the fixtures', () => {
  it('match the shared contracts the apps parse against', () => {
    expect(() => checkFixtures()).not.toThrow();
  });
});

describe('identity', () => {
  it('reads back the persona and scenario a refresh token names', () => {
    expect(readRefreshToken('vc.buyer.no-trades')).toEqual({
      persona: PERSONAS.buyer,
      scenario: 'no-trades',
    });
    expect(readRefreshToken('vc.buyer.elsewhere')).toBeNull();
    expect(readRefreshToken('a-real-looking-token')).toBeNull();
    expect(readRefreshToken(undefined)).toBeNull();
  });

  it('reads back the persona and scenario an access token names, and refuses anything else', () => {
    const token = accessTokenFor(PERSONAS.seller, 'with-trades', STANDIN_NOW_MS);
    expect(readBearer(`Bearer ${token}`)).toEqual({ persona: PERSONAS.seller, scenario: 'with-trades' });
    expect(readBearer(undefined)).toBeNull();
    expect(readBearer(`Bearer ${token}x`)).toBeNull();
    expect(readBearer('Bearer not.a.token')).toBeNull();
  });
});

describe('the stand-in over HTTP', () => {
  it('answers the routes the apps call, from fixtures typed against the contracts', async () => {
    const logged: string[] = [];
    const standin = await startStandin({ port: 0, log: (line) => logged.push(line) });
    try {
      const refresh = await fetch(`${standin.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'vc.buyer.with-trades' }),
      });
      expect(refresh.status).toBe(200);
      const session = (await refresh.json()) as { accessToken: string; scope: string };
      expect(session.scope).toBe('CONSUMER');
      const auth = { authorization: `Bearer ${session.accessToken}` };

      const viewer = await fetch(`${standin.apiUrl}/me/viewer`, { headers: auth });
      expect(viewerFactsSchema.parse(await viewer.json())).toEqual(PERSONAS.buyer.facts);

      const trades = await fetch(`${standin.apiUrl}/trades?state=ALL`, { headers: auth });
      const list = tradeListResponseSchema.parse(await trades.json());
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.nextCursor).toBeNull();

      const unsigned = await fetch(`${standin.apiUrl}/trades`);
      expect(unsigned.status).toBe(401);
      const unknown = await fetch(`${standin.apiUrl}/trades/0190b0a0-0000-7000-8000-000000000999`, {
        headers: auth,
      });
      expect(unknown.status).toBe(404);
      const unserved = await fetch(`${standin.apiUrl}/wallets/me`, { headers: auth });
      expect(unserved.status).toBe(404);
      expect(logged.some((line) => line.startsWith('UNMATCHED GET /v1/wallets/me'))).toBe(true);
    } finally {
      await standin.close();
    }
  });

  it('refuses a staff session on a consumer route, as the backend does', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const refresh = await fetch(`${standin.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'vc.staff.with-trades' }),
      });
      const { accessToken } = (await refresh.json()) as { accessToken: string };
      const viewer = await fetch(`${standin.apiUrl}/me/viewer`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(viewer.status).toBe(403);
    } finally {
      await standin.close();
    }
  });
});

describe('the session seeder', () => {
  it('seals a session the app sealer opens, with the persona facts and the access token digest', async () => {
    const cookies = await sessionCookiesFor('merchant', 'with-trades', 'localhost');
    const sealed = cookies.find((cookie) => cookie.name === 'komtru_session');
    const refresh = cookies.find((cookie) => cookie.name === 'komtru_rt');
    expect(sealed?.path).toBe('/');
    expect(refresh?.path).toBe('/api/auth');
    expect(refresh?.value).toBe('vc.merchant.with-trades');

    const hint = await createSessionSealer(STANDIN_SESSION_SECRET).open(sealed?.value, STANDIN_NOW_MS);
    expect(hint?.scope).toBe('CONSUMER');
    expect(hint?.facts).toEqual(PERSONAS.merchant.facts);
    expect(hint?.subject).toBe(
      await subjectDigest(accessTokenFor(PERSONAS.merchant, 'with-trades', STANDIN_NOW_MS)),
    );
  });

  it('is deterministic: the same persona seals the same cookie on every run', async () => {
    const first = await sessionCookiesFor('buyer', 'no-trades');
    const second = await sessionCookiesFor('buyer', 'no-trades');
    expect(second).toEqual(first);
  });

  it('refuses a session sealed with any other secret', async () => {
    const [sealed] = await sessionCookiesFor('buyer', 'no-trades');
    const forged = await createSessionSealer('some-other-secret-that-is-long-enough').open(
      sealed?.value,
      STANDIN_NOW_MS,
    );
    expect(forged).toBeNull();
  });
});

/** Signs in as a persona in a scenario over HTTP, the way the app does with its refresh token. */
async function signedIn(
  apiUrl: string,
  persona: PersonaId,
  scenario: ScenarioId,
): Promise<Record<string, string>> {
  const refresh = await fetch(`${apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: `vc.${persona}.${scenario}` }),
  });
  const { accessToken } = (await refresh.json()) as { accessToken: string };
  return { authorization: `Bearer ${accessToken}` };
}

describe('the trade, account and dispute routes over HTTP', () => {
  it('serves each trade the list shows, at its own id, parsed against the single-trade contract', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      for (const item of tradesFor('buyer', 'with-trades')) {
        const response = await fetch(`${standin.apiUrl}/trades/${item.id}`, { headers: auth });
        expect(response.status).toBe(200);
        const trade = tradeViewSchema.parse(await response.json());
        expect(trade.tradeCode).toBe(item.tradeCode);
        expect(trade.status).toBe(item.status);
      }
    } finally {
      await standin.close();
    }
  });

  it('covers the statuses the trade screens differ by, across the two personas', () => {
    const buyerStatuses = tradesFor('buyer', 'with-trades').map((trade) => trade.status);
    const sellerStatuses = tradesFor('seller', 'with-trades').map((trade) => trade.status);
    // A proposal awaiting an answer, an accepted trade awaiting funding, funded, delivered in inspection, disputed.
    expect(sellerStatuses).toContain('AWAITING_ACCEPTANCE');
    expect(buyerStatuses).toContain('PENDING_PAYMENT');
    expect(buyerStatuses).toContain('FUNDED');
    expect(buyerStatuses).toContain('INSPECTION');
    expect(buyerStatuses).toContain('DISPUTED');
  });

  it('answers a trade the person cannot see as not found, and an empty account with no trades', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const buyerTrade = tradesFor('buyer', 'with-trades')[0];
      const auth = await signedIn(standin.apiUrl, 'buyer', 'no-trades');
      const gone = await fetch(`${standin.apiUrl}/trades/${buyerTrade?.id ?? ''}`, { headers: auth });
      expect(gone.status).toBe(404);
      const me = meSchema.parse(await (await fetch(`${standin.apiUrl}/me`, { headers: auth })).json());
      expect(me.account.openTrades).toBe(false);
      expect(me.account.canClose).toBe(true);
    } finally {
      await standin.close();
    }
  });

  it('serves the open case on the disputed trade, its timeline, evidence and Y1 comparison', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const disputed = tradesFor('buyer', 'with-trades').find((trade) => trade.status === 'DISPUTED');
      const onTrade = await fetch(`${standin.apiUrl}/trades/${disputed?.id ?? ''}/dispute`, {
        headers: auth,
      });
      const dispute = disputeSchema.parse(await onTrade.json());
      expect(dispute.tradeId).toBe(disputed?.id);
      const detail = disputeDetailSchema.parse(
        await (await fetch(`${standin.apiUrl}/disputes/${dispute.id}`, { headers: auth })).json(),
      );
      expect(detail.yourRole).toBe('BUYER');
      const comparison = comparisonSchema.parse(
        await (
          await fetch(`${standin.apiUrl}/disputes/${dispute.id}/evidence-comparison`, { headers: auth })
        ).json(),
      );
      expect(comparison.seller.fromDispute.length).toBeGreaterThan(0);
      expect(comparison.buyer.fromDispute.length).toBeGreaterThan(0);
      const timeline = (await (
        await fetch(`${standin.apiUrl}/disputes/${dispute.id}/timeline`, { headers: auth })
      ).json()) as { items: unknown[] };
      expect(timeline.items.length).toBeGreaterThan(0);
    } finally {
      await standin.close();
    }
  });

  it('answers no case on a trade without one, and no dispute to a seller who is not a party to it', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const funded = tradesFor('buyer', 'with-trades').find((trade) => trade.status === 'FUNDED');
      const none = await fetch(`${standin.apiUrl}/trades/${funded?.id ?? ''}/dispute`, { headers: auth });
      expect(none.status).toBe(200);
      expect(await none.json()).toBeNull();
      expect(disputesFor('seller', 'with-trades')).toEqual([]);
    } finally {
      await standin.close();
    }
  });

  it('draws the merchant application in each state, and none for a person who has not started one', () => {
    expect(merchantApplicationFor('buyer', 'with-trades')).toBeNull();
    expect(merchantApplicationFor('seller', 'no-trades')).toBeNull();
    // A certified merchant with no state named is approved.
    expect(merchantApplicationFor('merchant', 'with-trades')?.status).toBe('APPROVED');
    const states = [
      ['application-draft', 'DRAFT'],
      ['application-in-review', 'IN_REVIEW'],
      ['application-changes-requested', 'CHANGES_REQUESTED'],
      ['application-rejected', 'REJECTED'],
      ['application-approved', 'APPROVED'],
    ] as const;
    for (const [scenario, status] of states) {
      const application = merchantApplicationFor('seller', scenario);
      expect(merchantApplicationSchema.parse(application).status).toBe(status);
    }
    expect(merchantApplicationFor('seller', 'application-changes-requested')?.changesRequested.length).toBe(
      2,
    );
  });
});

describe('the funding, inspection, standard and account reads over HTTP', () => {
  it('shows a trade awaiting funding with no attempt, and a funded trade with its confirmed attempt', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const pending = tradesFor('buyer', 'with-trades').find((trade) => trade.status === 'PENDING_PAYMENT');
      const awaiting = paymentStatusSchema.parse(
        await (
          await fetch(`${standin.apiUrl}/trades/${pending?.id ?? ''}/payment/status`, { headers: auth })
        ).json(),
      );
      expect(awaiting.displayState).toBe('NONE');
      expect(awaiting.attempt).toBeNull();
      const funded = tradesFor('buyer', 'with-trades').find((trade) => trade.status === 'FUNDED');
      expect(paymentStatusFor('buyer', 'with-trades', funded?.id ?? '')?.displayState).toBe('CONFIRMED');
    } finally {
      await standin.close();
    }
  });

  it('opens the inspection window on the trade in inspection, and closes it elsewhere', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const inspecting = tradesFor('buyer', 'with-trades').find((trade) => trade.status === 'INSPECTION');
      const open = getInspection.schema.response.parse(
        await (
          await fetch(`${standin.apiUrl}/trades/${inspecting?.id ?? ''}/inspection`, { headers: auth })
        ).json(),
      );
      expect(open.window.deadlineAt).not.toBeNull();
      const funded = tradesFor('buyer', 'with-trades').find((trade) => trade.status === 'FUNDED');
      const closed = getInspection.schema.response.parse(
        await (
          await fetch(`${standin.apiUrl}/trades/${funded?.id ?? ''}/inspection`, { headers: auth })
        ).json(),
      );
      expect(closed.window.deadlineAt).toBeNull();
    } finally {
      await standin.close();
    }
  });

  it('serves the trade standard a trade pinned, to anyone, and says so when it is not one of ours', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const pinned = tradesFor('buyer', 'with-trades')[0];
      const trade = (await (
        await fetch(`${standin.apiUrl}/trades/${pinned?.id ?? ''}`, { headers: auth })
      ).json()) as {
        standardVersionId: string;
      };
      // No session: a published standard is public.
      const standard = await fetch(
        `${standin.apiUrl}/config/trade-standards/versions/${trade.standardVersionId}`,
      );
      expect(standard.status).toBe(200);
      expect(tradeStandardSchema.parse(await standard.json()).versionId).toBe(trade.standardVersionId);
      const unknown = await fetch(
        `${standin.apiUrl}/config/trade-standards/versions/0190b0a0-0000-7000-8000-000000000999`,
      );
      expect(unknown.status).toBe(404);
    } finally {
      await standin.close();
    }
  });

  it('answers the account reads a verified seller and merchant have, and a buyer with none', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const sellerAuth = await signedIn(standin.apiUrl, 'seller', 'with-trades');
      const verification = verificationStatusSchema.parse(
        await (await fetch(`${standin.apiUrl}/verification/status`, { headers: sellerAuth })).json(),
      );
      expect(verification.level).toBe('IDENTITY_VERIFIED');
      const payouts = (await (
        await fetch(`${standin.apiUrl}/me/payout-accounts`, { headers: sellerAuth })
      ).json()) as {
        accounts: unknown[];
      };
      expect(payoutAccountSchema.parse(payouts.accounts[0]).status).toBe('VERIFIED');
      const addresses = (await (
        await fetch(`${standin.apiUrl}/me/addresses`, { headers: sellerAuth })
      ).json()) as {
        items: unknown[];
      };
      expect(addressSchema.parse(addresses.items[0]).isDefault).toBe(true);

      const buyerAuth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const buyerPayouts = (await (
        await fetch(`${standin.apiUrl}/me/payout-accounts`, { headers: buyerAuth })
      ).json()) as {
        accounts: unknown[];
      };
      expect(buyerPayouts.accounts).toEqual([]);
    } finally {
      await standin.close();
    }
  });
});

// F-069/F-073 deliver & inspect: the reads behind the workspace and the evidence screens.
describe('the trade workspace and evidence reads', () => {
  it('has a buyer trade in transit and a settled one, each with the single-trade view', () => {
    const statuses = tradesFor('buyer', 'with-trades').map((trade) => trade.status);
    expect(statuses).toContain('SHIPPED');
    expect(statuses).toContain('SETTLED');
  });

  it('serves the delivery deadline, the activity, the evidence by event and a file', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const shipped = tradesFor('buyer', 'with-trades').find((trade) => trade.status === 'SHIPPED');
      const base = `${standin.apiUrl}/trades/${shipped?.id ?? ''}`;

      const deadline = (await (await fetch(`${base}/delivery-deadline`, { headers: auth })).json()) as {
        deadline: { status: string } | null;
      };
      expect(deadline.deadline?.status).toBe('PENDING');

      const activity = await fetch(`${base}/activity`, { headers: auth });
      expect(activity.status).toBe(200);

      const all = (await (await fetch(`${base}/evidence`, { headers: auth })).json()) as { items: unknown[] };
      const dispatch = (await (await fetch(`${base}/evidence?event=DISPATCH`, { headers: auth })).json()) as {
        items: { event: string; fileId: string }[];
      };
      expect(dispatch.items.length).toBeGreaterThan(0);
      expect(dispatch.items.every((item) => item.event === 'DISPATCH')).toBe(true);
      expect(all.items.length).toBeGreaterThan(dispatch.items.length);

      const file = (await (
        await fetch(`${standin.apiUrl}/files/${dispatch.items[0]?.fileId ?? ''}`, { headers: auth })
      ).json()) as { url: string };
      expect(file.url.startsWith('data:image/')).toBe(true);

      const stranger = await fetch(`${standin.apiUrl}/trades/0190b0a0-0000-7000-8000-000000000999/evidence`, {
        headers: auth,
      });
      expect(stranger.status).toBe(404);
    } finally {
      await standin.close();
    }
  });

  it('only lists the evidence a trade has reached: no inspection photos before inspection, none before shipping', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const auth = await signedIn(standin.apiUrl, 'buyer', 'with-trades');
      const events = async (status: string): Promise<string[]> => {
        const trade = tradesFor('buyer', 'with-trades').find((candidate) => candidate.status === status);
        const read = (await (
          await fetch(`${standin.apiUrl}/trades/${trade?.id ?? ''}/evidence`, { headers: auth })
        ).json()) as { items: { event: string }[] };
        return [...new Set(read.items.map((item) => item.event))];
      };
      expect(await events('SHIPPED')).toEqual(['DISPATCH']);
      expect(await events('INSPECTION')).toEqual(['DISPATCH', 'INSPECTION']);
      expect(await events('FUNDED')).toEqual([]);
    } finally {
      await standin.close();
    }
  });
});
