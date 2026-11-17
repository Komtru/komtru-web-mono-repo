// What the proposal flow needs from other modules, as ports. Each production implementation reaches
// the other module through its barrel and nothing else; each test substitutes its own, so a proposal
// test does not need a Trade Standards seed, a geo catalog or Cloudinary.
import type { CounterpartyDisplay, Kobo } from '@komtru/shared-types';
import { and, eq, inArray } from 'drizzle-orm';
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
import { findServableFile, grantAccess, listGrants, revokeGrant } from '../../files/index.js';
import { userProfiles, users } from '../../identity/index.js';
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
  /** The M20 category the upload was made under; evidence accepts only the ones a person can choose for it. */
  category?: string;
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
  /** Takes the buyer's access back (decline, cancel, expiry). Idempotent; called after the trade commits. */
  revokeProofAccess(fileIds: readonly string[], buyerUserId: string): Promise<void>;
  snapshotFees(itemMinor: Kobo, sellerKind: SellerKind): TradeFeeSnapshot;
  /** M7 D4: hours a buyer has to confirm delivery, snapshotted onto the trade. */
  graceHours(): Promise<number>;
  /**
   * How other parties are shown in a trades list or header (T-068 follow-up): handle, display name and
   * an avatar URL, and only for users that still exist. See `postgresCounterpartyDisplays`.
   */
  displays(tx: Tx, userIds: readonly string[]): Promise<Map<string, CounterpartyDisplay>>;
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
              category: file.category,
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

export const postgresRevokeProofAccess =
  (db: Db): TradeDeps['revokeProofAccess'] =>
  async (fileIds, buyerUserId) => {
    for (const fileId of fileIds) {
      for (const grant of await listGrants(db, fileId)) {
        if (grant.granteeUserId === buyerUserId) await revokeGrant(db, fileId, grant.id);
      }
    }
  };

/**
 * The privacy rules, in one place:
 * - Only what party lookup (M1 8.2) already returns to any signed-in user: public id, handle, display
 *   name, avatar. Never email, phone, legal name, address or verification detail.
 * - The handle is shown only while the user has not hidden it from discovery (`discoverable_by_username`);
 *   a person who hid their handle is still the other side of the trade, but their handle is not volunteered.
 * - A user who is not ACTIVE-ish (erased, closed) is shown as no one: a trade list must not keep
 *   rendering an anonymised account's remnants.
 * - The avatar URL comes from `avatarUrls`, which signs through the files module exactly as party lookup does.
 */
const HIDDEN_STATUSES = ['ANONYMISED', 'CLOSED'];

export const postgresCounterpartyDisplays =
  (avatarUrls: (userIds: string[]) => Promise<Map<string, string | null>>): TradeDeps['displays'] =>
  async (tx, userIds) => {
    const out = new Map<string, CounterpartyDisplay>();
    if (userIds.length === 0) return out;
    const rows = await tx
      .select({
        id: users.id,
        publicId: users.publicId,
        username: users.username,
        discoverable: users.discoverableByUsername,
        status: users.status,
        displayName: userProfiles.displayName,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(inArray(users.id, [...userIds]));
    const shown = rows.filter((row) => !HIDDEN_STATUSES.includes(row.status));
    const avatars = await avatarUrls(shown.map((row) => row.id));
    for (const row of shown) {
      out.set(row.id, {
        publicId: row.publicId,
        username: row.discoverable ? (row.username ?? null) : null,
        displayName: row.displayName ?? null,
        avatarUrl: avatars.get(row.id) ?? null,
      });
    }
    return out;
  };

export { snapshotFees };
