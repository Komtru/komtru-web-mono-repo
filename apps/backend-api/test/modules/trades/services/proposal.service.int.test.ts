// T-061 against the real database: the proposal flow end to end through the service layer, with the
// other modules' ports replaced by fixtures (a standard, a city list, finished uploads). Skipped
// unless KOMTRU_INFRA_TESTS=1.
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NO_LOOKUP_BUDGET, skeleton } from '../../../../src/modules/identity/index.js';
import { snapshotFees } from '../../../../src/modules/config/index.js';
import type { TradeDeps, TradeStandard } from '../../../../src/modules/trades/services/ports.js';
import {
  acceptProposal,
  claimTradeInvitation,
  counterPropose,
  createProposal,
  expireTradeInvitation,
  previewProposal,
  sendProposal,
} from '../../../../src/modules/trades/services/proposal.service.js';
import {
  cancelTrade,
  declineTrade,
  getTrade,
} from '../../../../src/modules/trades/services/trade.service.js';
import { createEncryption } from '../../../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import type { ApiError } from '../../../../src/platform/errors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser } from '../../identity/infrastructure/postgres/support.js';
import { testConfig, testLogger } from '../../identity/support.js';
import { insertRow } from '../support.js';

const categoryId = randomUUID();
const standard: TradeStandard = {
  versionId: randomUUID(),
  categoryId,
  categoryCode: 'PHONES',
  categoryName: 'Phones',
  versionNumber: 3,
  createdAt: new Date(),
  inspectionWindowHours: 72,
  itemSpecFields: [
    { key: 'brand', label: 'Brand', required: true },
    { key: 'notes', label: 'Notes', required: false },
  ],
  proofMedia: { minPhotos: 2, requireVideo: false },
  imeiVerification: false,
  deliveryDeadlineDays: 7,
};
const SPEC = { brand: 'Apple' };
const PRICE = 45_000_000n;

const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected a rejection');
};

describe.runIf(infraEnabled)('proposal flow (T-061)', () => {
  const t = useTestDatabase();
  const granted: { fileIds: readonly string[]; buyer: string }[] = [];
  /** Finished uploads by id; each belongs to whoever `file()` says. */
  const files = new Map<
    string,
    { contentType: string; uploaderUserId: string; visibility: string; grantedUserIds: string[] }
  >();

  const deps = (overrides: Partial<TradeDeps> = {}): TradeDeps => ({
    db: t.db(),
    cities: (_db, ids) => Promise.resolve(ids.map((id) => ({ id, active: true })) as never),
    party: { db: t.db(), budget: NO_LOOKUP_BUDGET },
    invitations: {
      db: t.db(),
      hasher: createHmacHasher('a-pepper-for-tests-0123456789abc'),
      encryption: createEncryption(testConfig({ ENCRYPTION_KEY: randomBytes(32).toString('hex') })),
      logger: testLogger,
    },
    standards: { current: () => Promise.resolve(standard), pinned: () => Promise.resolve(standard) },
    proofFiles: (_tx, ids) =>
      Promise.resolve(
        ids.flatMap((id) => {
          const f = files.get(id);
          return f ? [{ id, ...f }] : [];
        }),
      ),
    grantProofAccess: (fileIds, buyer) => Promise.resolve(void granted.push({ fileIds, buyer })),
    snapshotFees,
    graceHours: () => Promise.resolve(48),
    ...overrides,
  });

  const person = async (username: string, overrides: Record<string, unknown> = {}) => {
    const id = await insertUser(t.owner(), {
      status: 'ACTIVE',
      verification_level: 'CONTACT_VERIFIED',
      username,
      username_skeleton: skeleton(username),
      ...overrides,
    });
    return { id, username };
  };

  const address = async (userId: string) =>
    insertRow(t.owner(), 'identity.user_addresses', {
      user_id: userId,
      label: 'Home',
      recipient_name: 'Jane Doe',
      recipient_phone: '+2348012345678',
      street_line: '14 Adeola Odeku Street',
      landmark: 'Opposite Eko Hotel',
      state_id: randomUUID(),
      city_id: randomUUID(),
    });

  const upload = (uploaderUserId: string, contentType = 'image/jpeg', visibility = 'PRIVATE_CASE') => {
    const id = randomUUID();
    files.set(id, { contentType, uploaderUserId, visibility, grantedUserIds: [] });
    return id;
  };

  const certify = (userId: string, status = 'ACTIVE') =>
    insertRow(t.owner(), 'identity.user_capabilities', { user_id: userId, capability: 'MERCHANT', status });

  /** A seller-initiated draft ready to send. */
  const sellerDraft = async (seller: { id: string }, withProof = true) =>
    createProposal(deps(), {
      userId: seller.id,
      role: 'SELLER',
      categoryCode: 'PHONES',
      itemAmountMinor: PRICE,
      itemSpec: SPEC,
      addressId: await address(seller.id),
      proofFileIds: withProof ? [upload(seller.id), upload(seller.id)] : [],
    });

  const activityTypes = async (tradeId: string) =>
    (
      await t
        .owner()
        .query<{ type: string }>(`SELECT type FROM trade.trade_activity WHERE trade_id = $1 ORDER BY id`, [
          tradeId,
        ])
    ).rows.map((r) => r.type);

  describe('create (G1, Z2, Z3)', () => {
    it('stores a draft with terms version 1 and the standard it was made under', async () => {
      const seller = await person('seller');
      const view = await sellerDraft(seller);
      expect(view.status).toBe('DRAFT');
      expect(view.terms).toMatchObject({ versionNumber: 1, itemAmountMinor: PRICE.toString() });
      expect(view.terms?.shipsFromAddress).toMatchObject({ street: '14 Adeola Odeku Street' });
      expect(view.terms?.deliveryAddress).toBeNull();
      const { rows } = await t
        .owner()
        .query(`SELECT trade_standard_version, delivery_grace_hours FROM trade.trades WHERE id = $1`, [
          view.id,
        ]);
      expect(rows[0]).toEqual({ trade_standard_version: 3, delivery_grace_hours: 48 });
    });

    it('refuses an incomplete item spec against the category standard', async () => {
      const seller = await person('seller');
      const error = await failure(
        createProposal(deps(), {
          userId: seller.id,
          role: 'SELLER',
          categoryCode: 'PHONES',
          itemAmountMinor: PRICE,
          itemSpec: { notes: 'x' },
          addressId: await address(seller.id),
        }),
      );
      expect([error.status, error.code]).toEqual([422, 'VALIDATION_FAILED']);
      expect(error.fieldErrors?.[0]?.path).toBe('itemSpec.brand');
    });

    it('answers 422 ADDRESS_REQUIRED without a usable saved address', async () => {
      const seller = await person('seller');
      const error = await failure(
        createProposal(deps(), {
          userId: seller.id,
          role: 'SELLER',
          categoryCode: 'PHONES',
          itemAmountMinor: PRICE,
          itemSpec: SPEC,
          addressId: randomUUID(),
        }),
      );
      expect([error.status, error.code]).toEqual([422, 'ADDRESS_REQUIRED']);
    });

    it("does not accept somebody else's address", async () => {
      const seller = await person('seller');
      const other = await person('other');
      const error = await failure(
        createProposal(deps(), {
          userId: seller.id,
          role: 'SELLER',
          categoryCode: 'PHONES',
          itemAmountMinor: PRICE,
          itemSpec: SPEC,
          addressId: await address(other.id),
        }),
      );
      expect(error.code).toBe('ADDRESS_REQUIRED');
    });

    it('refuses a certified merchant the buyer side, and records it', async () => {
      const merchant = await person('merchant');
      await certify(merchant.id);
      const error = await failure(
        createProposal(deps(), {
          userId: merchant.id,
          role: 'BUYER',
          categoryCode: 'PHONES',
          itemAmountMinor: PRICE,
          itemSpec: SPEC,
          addressId: await address(merchant.id),
        }),
      );
      expect(error.code).toBe('MERCHANT_CANNOT_BUY');
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'trades.eligibility.blocked'`);
      expect(rows).toHaveLength(1);
    });

    it('previews the sides, the requirements and the buyer total (Z3)', async () => {
      const merchant = await person('merchant');
      await certify(merchant.id);
      const preview = await previewProposal(deps(), {
        userId: merchant.id,
        role: 'SELLER',
        categoryCode: 'PHONES',
        itemAmountMinor: PRICE,
      });
      expect(preview.allowedRoles).toEqual(['SELLER']);
      expect(preview.standard.proofMedia).toEqual({ minPhotos: 2, requireVideo: false });
      expect(preview.fees).toHaveLength(1);
      expect(preview.fees[0]?.sellerKind).toBe('MERCHANT');
    });
  });

  describe('seller proposes to a user (W1, W3)', () => {
    it('sends, then the buyer accepts: fees frozen, both addresses in the accepted terms', async () => {
      const seller = await person('seller');
      const buyer = await person('buyer');
      const draft = await sellerDraft(seller);

      const sent = await sendProposal(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'buyer' },
      });
      expect(sent.status).toBe('AWAITING_ACCEPTANCE');
      expect(sent.awaiting).toBe('COUNTERPARTY');
      expect(granted.at(-1)?.buyer).toBe(buyer.id);

      const theirView = await getTrade(deps(), { userId: buyer.id, tradeId: draft.id });
      expect(theirView.awaiting).toBe('YOU');

      const noAddress = await failure(
        acceptProposal(deps(), {
          userId: buyer.id,
          tradeId: draft.id,
          termsVersionId: theirView.terms!.versionId,
        }),
      );
      expect(noAddress.code).toBe('ADDRESS_REQUIRED');

      const accepted = await acceptProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        termsVersionId: theirView.terms!.versionId,
        addressId: await address(buyer.id),
      });
      expect(accepted.status).toBe('PENDING_PAYMENT');
      expect(accepted.terms?.deliveryAddress).toMatchObject({ recipient: 'Jane Doe' });
      expect(accepted.terms?.shipsFromAddress).toMatchObject({ recipient: 'Jane Doe' });

      const expected = snapshotFees(PRICE, 'CASUAL');
      expect(accepted.fees).toMatchObject({
        scheduleVersion: expected.version,
        buyerTotalMinor: expected.amounts.buyerTotalMinor,
        buyerProtectionFeeMinor: expected.amounts.buyerProtectionFeeMinor,
      });
      expect(await activityTypes(draft.id)).toEqual(['NOTE', 'PROPOSAL_SENT', 'PROPOSAL_ACCEPTED']);

      // Idempotent: the same accept again returns the same trade, with no second transition.
      const again = await acceptProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        termsVersionId: theirView.terms!.versionId,
        addressId: await address(buyer.id),
      });
      expect(again.statusRevision).toBe(accepted.statusRevision);
    });

    it('prices a certified merchant seller at the merchant schedule', async () => {
      const seller = await person('seller');
      await certify(seller.id);
      const buyer = await person('buyer');
      const draft = await sellerDraft(seller);
      await sendProposal(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'buyer' },
      });
      const view = await getTrade(deps(), { userId: buyer.id, tradeId: draft.id });
      const accepted = await acceptProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        termsVersionId: view.terms!.versionId,
        addressId: await address(buyer.id),
      });
      const merchant = snapshotFees(PRICE, 'MERCHANT');
      expect(accepted.fees?.sellerProceedsMinor).toBe(merchant.amounts.sellerProceedsMinor);
    });

    it('will not send a seller proposal without proof media', async () => {
      const seller = await person('seller');
      await person('buyer');
      const draft = await sellerDraft(seller, false);
      const error = await failure(
        sendProposal(deps(), {
          userId: seller.id,
          tradeId: draft.id,
          counterparty: { channel: 'USERNAME', value: 'buyer' },
        }),
      );
      expect(error.status).toBe(422);
      expect(error.detail).toContain('2 more photos');
      expect((await getTrade(deps(), { userId: seller.id, tradeId: draft.id })).status).toBe('DRAFT');
    });

    it('heals a failed post-commit proof grant when the send is retried', async () => {
      const seller = await person('seller');
      const buyer = await person('buyer');
      const draft = await sellerDraft(seller);
      const send = {
        userId: seller.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME' as const, value: 'buyer' },
      };
      const failing = deps({ grantProofAccess: () => Promise.reject(new Error('files are down')) });
      await expect(sendProposal(failing, send)).rejects.toThrow('files are down');
      expect((await getTrade(deps(), { userId: seller.id, tradeId: draft.id })).status).toBe(
        'AWAITING_ACCEPTANCE',
      );
      const before = granted.length;
      const replay = await sendProposal(deps(), send);
      expect(replay.status).toBe('AWAITING_ACCEPTANCE');
      expect(granted.slice(before).map((g) => g.buyer)).toEqual([buyer.id]);
    });

    it("rejects proof that is not the seller's own or not private to the case", async () => {
      const seller = await person('seller');
      const other = await person('other');
      const error = await failure(
        createProposal(deps(), {
          userId: seller.id,
          role: 'SELLER',
          categoryCode: 'PHONES',
          itemAmountMinor: PRICE,
          itemSpec: SPEC,
          addressId: await address(seller.id),
          proofFileIds: [upload(other.id), upload(seller.id, 'image/png', 'PUBLIC')],
        }),
      );
      expect(error.status).toBe(422);
    });

    it('refuses proof that is already on another trade or granted to someone', async () => {
      const seller = await person('seller');
      const shared = upload(seller.id);
      const first = await createProposal(deps(), {
        userId: seller.id,
        role: 'SELLER',
        categoryCode: 'PHONES',
        itemAmountMinor: PRICE,
        itemSpec: SPEC,
        addressId: await address(seller.id),
        proofFileIds: [shared, upload(seller.id)],
      });
      const base = {
        userId: seller.id,
        role: 'SELLER' as const,
        categoryCode: 'PHONES',
        itemAmountMinor: PRICE,
        itemSpec: SPEC,
        addressId: await address(seller.id),
      };
      const onAnotherTrade = await failure(createProposal(deps(), { ...base, proofFileIds: [shared] }));
      expect(onAnotherTrade.status).toBe(422);

      const inUse = upload(seller.id);
      files.get(inUse)!.grantedUserIds = [randomUUID()];
      const granted = await failure(createProposal(deps(), { ...base, proofFileIds: [inUse] }));
      expect(granted.status).toBe(422);

      // The same files on the same trade are not "elsewhere": re-attaching is a no-op.
      const again = await sendProposal(deps(), {
        userId: seller.id,
        tradeId: first.id,
        counterparty: { channel: 'EMAIL', value: 'chidi@example.com' },
        proofFileIds: [shared],
      });
      expect(again.proofMediaCount).toBe(2);
    });

    it('caps the proof media on a trade at 20 across attachments', async () => {
      const seller = await person('seller');
      const draft = await createProposal(deps(), {
        userId: seller.id,
        role: 'SELLER',
        categoryCode: 'PHONES',
        itemAmountMinor: PRICE,
        itemSpec: SPEC,
        addressId: await address(seller.id),
        proofFileIds: Array.from({ length: 20 }, () => upload(seller.id)),
      });
      expect(draft.proofMediaCount).toBe(20);
      const over = await failure(
        sendProposal(deps(), {
          userId: seller.id,
          tradeId: draft.id,
          counterparty: { channel: 'EMAIL', value: 'chidi@example.com' },
          proofFileIds: [upload(seller.id)],
        }),
      );
      expect([over.status, over.code]).toEqual([422, 'VALIDATION_FAILED']);
      expect(over.title ?? over.message).toContain('at most 20');
    });

    it('rejects naming a certified merchant as the buyer, before send', async () => {
      const seller = await person('seller');
      const merchant = await person('merchant');
      await certify(merchant.id);
      const draft = await sellerDraft(seller);
      const error = await failure(
        sendProposal(deps(), {
          userId: seller.id,
          tradeId: draft.id,
          counterparty: { channel: 'USERNAME', value: 'merchant' },
        }),
      );
      expect([error.status, error.code]).toEqual([403, 'MERCHANT_CANNOT_BUY']);
      expect((await getTrade(deps(), { userId: seller.id, tradeId: draft.id })).status).toBe('DRAFT');
      expect(await activityTypes(draft.id)).toContain('ELIGIBILITY_BLOCKED');
    });

    it('checks canBuy again at acceptance', async () => {
      const seller = await person('seller');
      const buyer = await person('buyer');
      const draft = await sellerDraft(seller);
      await sendProposal(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'buyer' },
      });
      await certify(buyer.id);
      const view = await getTrade(deps(), { userId: buyer.id, tradeId: draft.id });
      const error = await failure(
        acceptProposal(deps(), {
          userId: buyer.id,
          tradeId: draft.id,
          termsVersionId: view.terms!.versionId,
          addressId: await address(buyer.id),
        }),
      );
      expect(error.code).toBe('MERCHANT_CANNOT_BUY');
    });

    it('refuses trading with yourself and hides trades from strangers', async () => {
      const seller = await person('seller');
      const stranger = await person('stranger');
      const draft = await sellerDraft(seller);
      expect(
        (
          await failure(
            sendProposal(deps(), {
              userId: seller.id,
              tradeId: draft.id,
              counterparty: { channel: 'USERNAME', value: 'seller' },
            }),
          )
        ).status,
      ).toBe(422);
      expect((await failure(getTrade(deps(), { userId: stranger.id, tradeId: draft.id }))).status).toBe(404);
    });
  });

  describe('buyer proposes to a seller', () => {
    const buyerDraft = async (buyer: { id: string }) =>
      createProposal(deps(), {
        userId: buyer.id,
        role: 'BUYER',
        categoryCode: 'PHONES',
        itemAmountMinor: PRICE,
        itemSpec: SPEC,
        addressId: await address(buyer.id),
      });

    it("needs the seller's proof at acceptance and their ships-from address (W1)", async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const view = await getTrade(deps(), { userId: seller.id, tradeId: draft.id });
      const base = { userId: seller.id, tradeId: draft.id, termsVersionId: view.terms!.versionId };

      const noProof = await failure(acceptProposal(deps(), { ...base, addressId: await address(seller.id) }));
      expect(noProof.status).toBe(422);
      expect(noProof.detail).toContain('photos');

      const accepted = await acceptProposal(deps(), {
        ...base,
        addressId: await address(seller.id),
        proofFileIds: [upload(seller.id), upload(seller.id)],
      });
      expect(accepted.status).toBe('PENDING_PAYMENT');
      expect(accepted.proofMediaCount).toBe(2);
      expect(granted.at(-1)?.buyer).toBe(buyer.id);
    });

    it('lets a counter-proposal flip the turn and refuses answering your own proposal (W2, BR1)', async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      const sent = await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const first = await getTrade(deps(), { userId: seller.id, tradeId: draft.id });

      const own = await failure(
        acceptProposal(deps(), {
          userId: buyer.id,
          tradeId: draft.id,
          termsVersionId: sent.terms!.versionId,
        }),
      );
      expect(own.status).toBe(409);

      const countered = await counterPropose(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        expectedRevision: first.statusRevision,
        itemAmountMinor: 50_000_000n,
        addressId: await address(seller.id),
      });
      expect(countered.terms).toMatchObject({ versionNumber: 2, proposedByRole: 'SELLER' });
      expect(countered.awaiting).toBe('COUNTERPARTY');
      expect((await getTrade(deps(), { userId: buyer.id, tradeId: draft.id })).awaiting).toBe('YOU');

      // A second counter from a stale screen loses rather than overwriting.
      const stale = await failure(
        counterPropose(deps(), {
          userId: buyer.id,
          tradeId: draft.id,
          expectedRevision: first.statusRevision,
          itemAmountMinor: 1n,
        }),
      );
      expect(stale.status).toBe(409);

      // The buyer cannot accept the superseded version.
      const outdated = await failure(
        acceptProposal(deps(), {
          userId: seller.id,
          tradeId: draft.id,
          termsVersionId: first.terms!.versionId,
        }),
      );
      expect(outdated.status).toBe(409);
      expect(await activityTypes(draft.id)).toContain('COUNTER_PROPOSED');
    });

    it('answers a retried counter with the trade as it stands, and refuses one that changes nothing', async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const first = await getTrade(deps(), { userId: seller.id, tradeId: draft.id });
      const sellerAddress = await address(seller.id);

      const counter = {
        userId: seller.id,
        tradeId: draft.id,
        expectedRevision: first.statusRevision,
        itemAmountMinor: 50_000_000n,
        addressId: sellerAddress,
      };
      const countered = await counterPropose(deps(), counter);
      const retried = await counterPropose(deps(), counter);
      expect(retried.statusRevision).toBe(countered.statusRevision);
      expect(retried.terms?.versionNumber).toBe(countered.terms?.versionNumber);
      expect(await activityTypes(draft.id)).toEqual(['NOTE', 'PROPOSAL_SENT', 'COUNTER_PROPOSED']);

      // The buyer's turn: sending back the very same price is not a counter.
      const nothing = await failure(
        counterPropose(deps(), {
          userId: buyer.id,
          tradeId: draft.id,
          expectedRevision: countered.statusRevision,
          itemAmountMinor: 50_000_000n,
        }),
      );
      expect([nothing.status, nothing.code]).toEqual([422, 'VALIDATION_FAILED']);
    });

    it('re-checks canBuy when a buyer counters', async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const first = await getTrade(deps(), { userId: seller.id, tradeId: draft.id });
      await counterPropose(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        expectedRevision: first.statusRevision,
        itemAmountMinor: 50_000_000n,
        addressId: await address(seller.id),
      });
      await certify(buyer.id);
      const now = await getTrade(deps(), { userId: buyer.id, tradeId: draft.id });
      const error = await failure(
        counterPropose(deps(), {
          userId: buyer.id,
          tradeId: draft.id,
          expectedRevision: now.statusRevision,
          itemAmountMinor: 48_000_000n,
        }),
      );
      expect(error.code).toBe('MERCHANT_CANNOT_BUY');
    });

    it('answers a wrong-state accept with 409 INVALID_TRANSITION before any address or proof check', async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const view = await getTrade(deps(), { userId: seller.id, tradeId: draft.id });
      await cancelTrade(deps(), { userId: buyer.id, tradeId: draft.id });
      // No address, no proof: those would be 422s if the state were checked second.
      const error = await failure(
        acceptProposal(deps(), {
          userId: seller.id,
          tradeId: draft.id,
          termsVersionId: view.terms!.versionId,
        }),
      );
      expect([error.status, error.code]).toEqual([409, 'INVALID_TRANSITION']);
    });

    it('replays an accept only for the person who accepted', async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const view = await getTrade(deps(), { userId: seller.id, tradeId: draft.id });
      const accept = {
        userId: seller.id,
        tradeId: draft.id,
        termsVersionId: view.terms!.versionId,
        addressId: await address(seller.id),
        proofFileIds: [upload(seller.id), upload(seller.id)],
      };
      const accepted = await acceptProposal(deps(), accept);
      expect((await acceptProposal(deps(), accept)).statusRevision).toBe(accepted.statusRevision);
      // The proposer asking to accept the same trade is not a replay, whatever version they quote.
      const other = await failure(
        acceptProposal(deps(), {
          userId: buyer.id,
          tradeId: draft.id,
          termsVersionId: accepted.terms!.versionId,
        }),
      );
      expect([other.status, other.code]).toEqual([409, 'INVALID_TRANSITION']);
    });

    it('declines with a reason (SD1) and replays harmlessly', async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      expect(
        (await failure(declineTrade(deps(), { userId: seller.id, tradeId: draft.id, reason: ' ' }))).status,
      ).toBe(422);
      const declined = await declineTrade(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        reason: 'Price too low',
      });
      expect(declined.status).toBe('DECLINED');
      const again = await declineTrade(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        reason: 'Price too low',
      });
      expect(again.statusRevision).toBe(declined.statusRevision);
      const { rows } = await t
        .owner()
        .query(
          `SELECT summary FROM trade.trade_activity WHERE trade_id = $1 AND type = 'PROPOSAL_DECLINED'`,
          [draft.id],
        );
      expect(rows).toEqual([{ summary: 'Price too low' }]);
    });

    it('cancels before funding (CT1), at draft and after acceptance, but not twice', async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await buyerDraft(buyer);
      const cancelled = await cancelTrade(deps(), { userId: buyer.id, tradeId: draft.id });
      expect(cancelled.status).toBe('CANCELLED');
      expect((await cancelTrade(deps(), { userId: buyer.id, tradeId: draft.id })).statusRevision).toBe(
        cancelled.statusRevision,
      );
      const { rows } = await t
        .owner()
        .query(`SELECT cancellation_reason FROM trade.trades WHERE id = $1`, [draft.id]);
      expect(rows[0]).toEqual({ cancellation_reason: 'BUYER_WITHDREW' });

      const next = await buyerDraft(buyer);
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: next.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const view = await getTrade(deps(), { userId: seller.id, tradeId: next.id });
      await acceptProposal(deps(), {
        userId: seller.id,
        tradeId: next.id,
        termsVersionId: view.terms!.versionId,
        addressId: await address(seller.id),
        proofFileIds: [upload(seller.id), upload(seller.id)],
      });
      expect((await cancelTrade(deps(), { userId: seller.id, tradeId: next.id })).status).toBe('CANCELLED');
    });
  });

  describe('concurrency', () => {
    /** A sent buyer proposal, with the seller about to answer it. */
    const openProposal = async () => {
      const buyer = await person('buyer');
      const seller = await person('seller');
      const draft = await createProposal(deps(), {
        userId: buyer.id,
        role: 'BUYER',
        categoryCode: 'PHONES',
        itemAmountMinor: PRICE,
        itemSpec: SPEC,
        addressId: await address(buyer.id),
      });
      await sendProposal(deps(), {
        userId: buyer.id,
        tradeId: draft.id,
        counterparty: { channel: 'USERNAME', value: 'seller' },
      });
      const view = await getTrade(deps(), { userId: seller.id, tradeId: draft.id });
      return { buyer, seller, tradeId: draft.id, view };
    };

    const count = async (tradeId: string, type: string) =>
      (
        await t
          .owner()
          .query(`SELECT 1 FROM trade.trade_activity WHERE trade_id = $1 AND type = $2`, [tradeId, type])
      ).rows.length;

    it('lets one of two simultaneous accepts win and answers the other as a replay', async () => {
      const { seller, tradeId, view } = await openProposal();
      const accept = {
        userId: seller.id,
        tradeId,
        termsVersionId: view.terms!.versionId,
        addressId: await address(seller.id),
        proofFileIds: [upload(seller.id), upload(seller.id)],
      };
      const [a, b] = await Promise.all([acceptProposal(deps(), accept), acceptProposal(deps(), accept)]);
      expect([a.status, b.status]).toEqual(['PENDING_PAYMENT', 'PENDING_PAYMENT']);
      expect(a.statusRevision).toBe(b.statusRevision);
      expect(await count(tradeId, 'PROPOSAL_ACCEPTED')).toBe(1);
    });

    it('lets an accept and a counter race: one wins, the other is a 409 CONFLICT', async () => {
      const { seller, tradeId, view } = await openProposal();
      const results = await Promise.allSettled([
        acceptProposal(deps(), {
          userId: seller.id,
          tradeId,
          termsVersionId: view.terms!.versionId,
          addressId: await address(seller.id),
          proofFileIds: [upload(seller.id), upload(seller.id)],
        }),
        counterPropose(deps(), {
          userId: seller.id,
          tradeId,
          expectedRevision: view.statusRevision,
          itemAmountMinor: 50_000_000n,
          addressId: await address(seller.id),
        }),
      ]);
      const lost = results.filter((r) => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(lost).toHaveLength(1);
      const error = (lost[0] as PromiseRejectedResult).reason as ApiError;
      expect([error.status, error.code]).toEqual([409, 'CONFLICT']);
      expect((await count(tradeId, 'PROPOSAL_ACCEPTED')) + (await count(tradeId, 'COUNTER_PROPOSED'))).toBe(
        1,
      );
    });

    it('lets two counters at the same revision race: one wins, one version is written', async () => {
      const { seller, tradeId, view } = await openProposal();
      const counter = async (amount: bigint) =>
        counterPropose(deps(), {
          userId: seller.id,
          tradeId,
          expectedRevision: view.statusRevision,
          itemAmountMinor: amount,
          addressId: await address(seller.id),
        });
      const results = await Promise.allSettled([counter(50_000_000n), counter(51_000_000n)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect([(lost.reason as ApiError).status, (lost.reason as ApiError).code]).toEqual([409, 'CONFLICT']);
      const { rows } = await t
        .owner()
        .query(`SELECT version_number FROM trade.trade_terms_versions WHERE trade_id = $1 ORDER BY 1`, [
          tradeId,
        ]);
      expect(rows.map((r: { version_number: number }) => r.version_number)).toEqual([1, 2]);
    });
  });

  describe('invitations (non-users)', () => {
    it('parks the trade in PENDING_COUNTERPARTY, binds on claim, and needs an address to claim', async () => {
      const seller = await person('seller');
      const draft = await sellerDraft(seller);
      const sent = await sendProposal(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        counterparty: { channel: 'EMAIL', value: 'chidi@example.com' },
      });
      expect(sent.status).toBe('PENDING_COUNTERPARTY');
      const { rows } = await t
        .owner()
        .query<{ counterparty_invitation_id: string }>(
          `SELECT counterparty_invitation_id FROM trade.trades WHERE id = $1`,
          [draft.id],
        );
      const invitationId = rows[0]!.counterparty_invitation_id;

      const claimer = await person('chidi');
      await t
        .owner()
        .query(
          `UPDATE identity.party_invitations SET status = 'CLAIMED', claimed_by_user_id = $1, claimed_at = now() WHERE id = $2`,
          [claimer.id, invitationId],
        );

      const stranger = await person('stranger');
      expect(
        (await failure(claimTradeInvitation(deps(), { userId: stranger.id, tradeId: draft.id }))).status,
      ).toBe(404);

      const noAddress = await failure(
        claimTradeInvitation(deps(), { userId: claimer.id, tradeId: draft.id }),
      );
      expect([noAddress.status, noAddress.code]).toEqual([422, 'ADDRESS_REQUIRED']);

      await address(claimer.id);
      const claimed = await claimTradeInvitation(deps(), { userId: claimer.id, tradeId: draft.id });
      expect(claimed.status).toBe('AWAITING_ACCEPTANCE');
      expect(claimed.yourRole).toBe('BUYER');
      // The claim binds the buyer, so the seller's proof opens to them now (and not before).
      expect(granted.filter((g) => g.buyer === claimer.id)).toHaveLength(1);
      // Replay changes nothing.
      expect(
        (await claimTradeInvitation(deps(), { userId: claimer.id, tradeId: draft.id })).statusRevision,
      ).toBe(claimed.statusRevision);
    });

    it('re-checks canBuy at claim', async () => {
      const seller = await person('seller');
      const draft = await sellerDraft(seller);
      await sendProposal(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        counterparty: { channel: 'EMAIL', value: 'chidi@example.com' },
      });
      const claimer = await person('chidi');
      await certify(claimer.id);
      await address(claimer.id);
      await t
        .owner()
        .query(
          `UPDATE identity.party_invitations SET status = 'CLAIMED', claimed_by_user_id = $1, claimed_at = now()`,
          [claimer.id],
        );
      const error = await failure(claimTradeInvitation(deps(), { userId: claimer.id, tradeId: draft.id }));
      expect(error.code).toBe('MERCHANT_CANNOT_BUY');
    });

    it('expires an unclaimed invitation, once', async () => {
      const seller = await person('seller');
      const draft = await sellerDraft(seller);
      await sendProposal(deps(), {
        userId: seller.id,
        tradeId: draft.id,
        counterparty: { channel: 'EMAIL', value: 'chidi@example.com' },
      });
      const { rows } = await t
        .owner()
        .query<{ counterparty_invitation_id: string }>(
          `SELECT counterparty_invitation_id FROM trade.trades WHERE id = $1`,
          [draft.id],
        );
      const input = { tradeId: draft.id, invitationId: rows[0]!.counterparty_invitation_id };
      await expireTradeInvitation(deps(), input);
      await expireTradeInvitation(deps(), input);
      expect((await getTrade(deps(), { userId: seller.id, tradeId: draft.id })).status).toBe('EXPIRED');
    });
  });
});
