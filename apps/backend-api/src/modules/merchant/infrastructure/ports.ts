// Binds the merchant module's six questions (services/ports.ts) to the real barrels. This is the only file
// in the module that names `files`, `geo`, `config`, `ledger` or `trust`, so the whole cross-module
// surface is readable here in one screen.
import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '../../../config/env.js';
import type { Db } from '../../../db/index.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import { listCurrentStandards } from '../../config/index.js';
import { findFile, grantAccess, retrieveFile } from '../../files/index.js';
import { getCitiesByIds } from '../../geo/index.js';
import { rolesWithPermission } from '../../identity/index.js';
import { payoutAccounts } from '../../ledger/index.js';
import { requestBusinessEvidence } from '../../trust/index.js';
import { COLLECT_EVIDENCE_QUEUE } from '../domain/queues.js';
import type { EvidenceJob, MerchantPorts } from '../services/ports.js';

export interface PortsRuntime {
  db: Db;
  config: AppConfig;
  logger: Logger;
  queues: QueueFactory;
  encryption: Encryption;
}

/** The roles that may decide an application, read from the RBAC catalogue rather than listed here twice. */
export const reviewerRoles = (): string[] => rolesWithPermission('merchant.application.view');

export function bindPorts(runtime: PortsRuntime): MerchantPorts {
  const { db, config, logger } = runtime;
  return {
    findFile: async (fileId) => {
      const file = await findFile(db, fileId);
      return file
        ? {
            id: file.id,
            uploaderUserId: file.uploaderUserId,
            category: file.category,
            status: file.status,
            uploadState: file.uploadState,
            contentType: file.contentType,
          }
        : undefined;
    },

    grantReviewerAccess: async (fileId) => {
      for (const granteeRole of reviewerRoles()) {
        await grantAccess(db, { fileId, granteeRole, reason: 'Merchant application review' });
      }
    },

    cityBelongsToState: async (stateId, cityId) => {
      const [city] = await getCitiesByIds(db, [cityId]);
      return city !== undefined && city.active && city.stateId === stateId;
    },

    locationLabel: async (cityId) => {
      const [city] = await getCitiesByIds(db, [cityId]);
      return city ? { stateName: city.stateName, cityName: city.name } : undefined;
    },

    categoryCodes: async () => (await listCurrentStandards(db)).map((standard) => standard.categoryCode),

    payoutAccountOf: async (userId, payoutAccountId) => {
      const [account] = await db
        .select({
          id: payoutAccounts.id,
          status: payoutAccounts.status,
          bankName: payoutAccounts.bankName,
          accountNumberMasked: payoutAccounts.accountNumberMasked,
          accountName: payoutAccounts.accountName,
          nameMatchResult: payoutAccounts.nameMatchResult,
        })
        .from(payoutAccounts)
        .where(and(eq(payoutAccounts.id, payoutAccountId), eq(payoutAccounts.userId, userId)))
        .limit(1);
      return account;
    },

    signDocument: async (fileId, viewer) => {
      try {
        const result = await retrieveFile(
          db,
          { files: config.files, logger },
          { fileId, subject: { userId: viewer.userId, scope: 'STAFF', roles: [...viewer.roles] } },
        );
        return { url: result.url, expiresAt: result.expiresAt, contentType: result.contentType };
      } catch (error) {
        // A removed or refused file is shown as unavailable; anything else is a fault worth a 500.
        if (
          error instanceof ApiError &&
          (error.status === 404 || error.status === 410 || error.status === 409)
        ) {
          return undefined;
        }
        throw error;
      }
    },

    requestCacLookup: (input) =>
      requestBusinessEvidence(
        {
          db,
          encryption: runtime.encryption,
          requestTtlMinutes: config.trust.requestTtlMinutes,
          logger,
          queues: runtime.queues,
        },
        input,
      ),

    enqueueEvidence: async (job: EvidenceJob, delayMs?: number) => {
      await runtime.queues.producer<EvidenceJob>(COLLECT_EVIDENCE_QUEUE).add('collect', job, {
        // A stamp in the id: a resubmission's first run must not collide with a retained earlier job.
        jobId: `${job.applicationId}-${String(job.attempt)}-${String(Date.now())}`,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
        ...(delayMs === undefined ? {} : { delay: delayMs }),
      });
    },
  };
}
