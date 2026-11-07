// What the proposal flow needs from other modules, as ports. Each production implementation reaches
// the other module through its barrel and nothing else; each test substitutes its own, so a proposal
// test does not need a Trade Standards seed, a geo catalog or Cloudinary.
import type { Kobo } from '@komtru/shared-types';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { Tx } from '../../../platform/events/publish.js';
import {
  getCurrentStandard,
  getStandardVersion,
  snapshotFees,
  tradeCategories,
  tradeStandards,
  type StandardView,
} from '../../config/index.js';
import { findServableFile, grantAccess, listGrants } from '../../files/index.js';
import type { CityLookup, InvitationDeps, PartyDeps } from '../../identity/index.js';
import type { SellerKind, TradeFeeSnapshot } from '../domain/feeSnapshot.js';

export interface TradeStandard extends StandardView {
  categoryId: string;
}

export interface ProofFile {
  id: string;
  contentType: string;
  uploaderUserId: string;
  visibility: string;
  /** Users holding a live access grant on the file; a file granted to anyone is already in use. */
  grantedUserIds: string[];
}

export interface TradeDeps {
  db: Db;
  /** The geo catalog's city lookup; a saved address is usable only while its city is active. */
  cities: CityLookup;
  /** Party lookup (budget-charged) and invitations, exactly as identity's own routes use them. */
  party: PartyDeps;
  invitations: InvitationDeps;
  /** The category's current standard (new trades) or the version a trade pinned (later steps). */
  standards: {
    current(categoryCode: string): Promise<TradeStandard>;
    pinned(categoryId: string, versionNumber: number): Promise<TradeStandard>;
  };
  /** READY, ACTIVE files only; an unknown, pending or tombstoned id is simply absent. */
  proofFiles(tx: Tx, ids: readonly string[]): Promise<ProofFile[]>;
  /** Lets the buyer see the seller's proof. Idempotent; called after the trade commits. */
  grantProofAccess(fileIds: readonly string[], buyerUserId: string, tradeCode: string): Promise<void>;
  snapshotFees(itemMinor: Kobo, sellerKind: SellerKind): TradeFeeSnapshot;
  /** M7 D4: hours a buyer has to confirm delivery, snapshotted onto the trade. */
  graceHours(): Promise<number>;
}

export const postgresStandards = (db: Db): TradeDeps['standards'] => {
  const withCategory = async (view: StandardView): Promise<TradeStandard> => {
    const [category] = await db
      .select({ id: tradeCategories.id })
      .from(tradeCategories)
      .where(eq(tradeCategories.code, view.categoryCode));
    if (!category) throw new Error(`trades: category ${view.categoryCode} vanished mid-request`);
    return { ...view, categoryId: category.id };
  };
  return {
    current: async (code) => withCategory(await getCurrentStandard(db, code)),
    pinned: async (categoryId, versionNumber) => {
      const [row] = await db
        .select({ id: tradeStandards.id })
        .from(tradeStandards)
        .where(
          and(eq(tradeStandards.categoryId, categoryId), eq(tradeStandards.versionNumber, versionNumber)),
        );
      if (!row) throw new Error(`trades: standard version ${versionNumber} of ${categoryId} is missing`);
      return withCategory(await getStandardVersion(db, row.id));
    },
  };
};

export const postgresProofFiles = (): TradeDeps['proofFiles'] => async (tx, ids) => {
  const found = await Promise.all(ids.map((id) => findServableFile(tx, id)));
  return Promise.all(
    found.flatMap((file) =>
      file
        ? [
            listGrants(tx, file.id).then((grants) => ({
              id: file.id,
              contentType: file.contentType,
              uploaderUserId: file.uploaderUserId,
              visibility: file.visibility,
              grantedUserIds: grants.flatMap((g) => (g.granteeUserId ? [g.granteeUserId] : [])),
            })),
          ]
        : [],
    ),
  );
};

export const postgresGrantProofAccess =
  (db: Db): TradeDeps['grantProofAccess'] =>
  async (fileIds, buyerUserId, tradeCode) => {
    for (const fileId of fileIds) {
      await grantAccess(db, {
        fileId,
        granteeUserId: buyerUserId,
        reason: `Seller proof for trade ${tradeCode}`,
      });
    }
  };

export { snapshotFees };
