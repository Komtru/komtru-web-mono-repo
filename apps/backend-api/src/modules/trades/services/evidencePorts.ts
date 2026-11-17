// What attaching evidence needs from the files module, as ports in the style of fulfilmentPorts.ts. Kept apart from
// TradeDeps so the proposal flow's fixtures did not change.
import type { Db } from '../../../db/index.js';
import type { Tx } from '../../../platform/events/publish.js';
import { findFile, grantAccess } from '../../files/index.js';
import type { TradeDeps } from './ports.js';

/** Where an upload stands, for telling "still landing" apart from "not yours or not usable". */
export interface FileProgress {
  uploaderUserId: string;
  uploadState: string;
  status: string;
}

export interface EvidenceDeps {
  db: Db;
  /** READY, ACTIVE files only, with who uploaded them, how they may be seen and who already holds a grant. */
  proofFiles: TradeDeps['proofFiles'];
  fileProgress(tx: Tx, ids: readonly string[]): Promise<Map<string, FileProgress>>;
  /** Lets the other party see the files (M20 PRIVATE_CASE). Idempotent; called after the evidence commits. */
  grantEvidenceAccess(fileIds: readonly string[], granteeUserId: string, tradeCode: string): Promise<void>;
}

export const postgresFileProgress: EvidenceDeps['fileProgress'] = async (tx, ids) => {
  const out = new Map<string, FileProgress>();
  for (const id of ids) {
    const file = await findFile(tx, id);
    if (file)
      out.set(id, {
        uploaderUserId: file.uploaderUserId,
        uploadState: file.uploadState,
        status: file.status,
      });
  }
  return out;
};

export const postgresGrantEvidenceAccess =
  (db: Db): EvidenceDeps['grantEvidenceAccess'] =>
  async (fileIds, granteeUserId, tradeCode) => {
    for (const fileId of fileIds) {
      await grantAccess(db, { fileId, granteeUserId, reason: `Evidence on trade ${tradeCode}` });
    }
  };
