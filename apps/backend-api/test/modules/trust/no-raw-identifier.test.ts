// The ticket's own acceptance criterion: after a verification run, scan everything this module
// touched for the raw number.
//
// It asserts over the SERIALISED whole of each sink rather than over named fields, so a column, an
// event payload field or a log key added later cannot quietly start carrying it. The matching
// database-level scan is in test/integration/verification.int.test.ts.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { runIdentityCheck } from '../../../src/modules/trust/jobs/run-identity-check.job.js';
import { submitIdentifierCheck } from '../../../src/modules/trust/services/verification.service.js';
import type { TrustJobDeps } from '../../../src/modules/trust/jobs/deps.js';
import type { KycProviderAdapter } from '../../../src/modules/trust/domain/provider.js';
import { createFakeKycClient } from '../../../src/modules/trust/infrastructure/providers/fake-kyc.client.js';
import type { Logger } from '../../../src/platform/logger.js';
import { requestRow, stubStore, testEncryption, testHasher, uniqueViolation } from './support.js';

/** Every digit string the test uses, so a partial leak is caught as well as a whole one. */
const RAW_NIN = '12345678902'; // ends in 2: LOW_CONFIDENCE, the branch that logs the most
const RAW_PASSING_NIN = '12345678904';
const FIRST_NAME = 'Ngozi';
const LAST_NAME = 'Adeyemi';
const DOB = '1994-02-03';

/** A logger that keeps every line, at trace level, so nothing is filtered out of the scan. */
const capturingLogger = (): { logger: Logger; lines: string[] } => {
  const lines: string[] = [];
  const logger = pino(
    { level: 'trace' },
    { write: (line: string) => void lines.push(line) },
  ) as unknown as Logger;
  return { logger, lines };
};

const run = async (
  identifier: string,
  adapter: KycProviderAdapter,
  options: { duplicate?: boolean } = {},
) => {
  const { logger, lines } = capturingLogger();
  const encryption = testEncryption();
  const userId = randomUUID();

  const submitStore = stubStore();
  const submitted = await submitIdentifierCheck(
    { store: submitStore, hasher: testHasher(), encryption, requestTtlMinutes: 60, logger },
    { userId, type: 'NIN', identifier, firstName: FIRST_NAME, lastName: LAST_NAME, dateOfBirth: DOB },
  );

  const request = requestRow({ id: submitted.requestId, userId, verificationType: 'NIN' });
  const jobStore = stubStore({
    request,
    facts: { identifierVerified: true, livenessPassed: true },
    ...(options.duplicate
      ? {
          applyIdentityOutcomeThrows: uniqueViolation('nin_verifications_hash_active_unique'),
          identifierOwner: randomUUID(),
        }
      : {}),
  });
  const emitted: unknown[] = [];
  const deps: TrustJobDeps = {
    store: jobStore,
    adapter,
    hasher: testHasher(),
    encryption,
    gateway: {
      emitToUser: (u, e, p) => void emitted.push({ u, e, p }),
      emitToRoom: () => {},
      registerRoomAuthorizer: () => {},
      disconnectUser: () => {},
      connectionCount: () => 0,
    },
    logger,
  };
  await runIdentityCheck(deps, { requestId: request.id, sealed: submitted.job.sealed });

  return {
    lines,
    emitted,
    sealed: submitted.job.sealed,
    // The matched name is kept on purpose, in exactly two fields (`verified_first_name` and
    // `verified_last_name`), because the CAC officer match reads it; every OTHER write must be clean.
    writes: JSON.stringify(
      [
        submitStore.requests,
        jobStore.identityOutcomes,
        jobStore.duplicates,
        jobStore.livenessOutcomes,
        jobStore.providerCalls,
        jobStore.grants,
      ],
      (key, value: unknown) => (key === 'verifiedFirstName' || key === 'verifiedLastName' ? '[kept]' : value),
    ),
    outcomes: jobStore.identityOutcomes,
  };
};

const SECRETS = [RAW_NIN, RAW_PASSING_NIN, FIRST_NAME, LAST_NAME, DOB];

describe('a verification run leaves no raw identifier behind', () => {
  it('keeps the matched name only in the two verified-name fields', async () => {
    const { outcomes } = await run(RAW_PASSING_NIN, createFakeKycClient());
    expect(outcomes[0]).toMatchObject({ verifiedFirstName: FIRST_NAME, verifiedLastName: LAST_NAME });
  });

  it('writes none of the claim to any table', async () => {
    const { writes } = await run(RAW_PASSING_NIN, createFakeKycClient());
    for (const secret of SECRETS) expect(writes).not.toContain(secret);
  });

  it('logs none of the claim on the duplicate branch, which is the one that logs the most', async () => {
    // The §7 branch writes a WARN carrying the request, the type and the other account's id. It is
    // the line most likely to grow a "and here is the number" field under pressure from support.
    const { lines } = await run(RAW_PASSING_NIN, createFakeKycClient(), { duplicate: true });
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of SECRETS) expect(lines.join('\n')).not.toContain(secret);
  });

  it('logs none of the claim when the provider throws and the error travels', async () => {
    // Ends in 3: the fake's scripted exception. An error path is where a careless log line goes in.
    const { lines, writes } = await run('12345678903', createFakeKycClient()).catch(() => ({
      lines: [] as string[],
      writes: '',
    }));
    for (const secret of ['12345678903', FIRST_NAME, LAST_NAME]) {
      expect(lines.join('\n')).not.toContain(secret);
      expect(writes).not.toContain(secret);
    }
  });

  it('puts none of the claim on the socket', async () => {
    const { emitted } = await run(RAW_PASSING_NIN, createFakeKycClient());
    for (const secret of SECRETS) expect(JSON.stringify(emitted)).not.toContain(secret);
  });

  it('seals the job payload, so the claim is not readable in Redis', async () => {
    const { sealed } = await run(RAW_PASSING_NIN, createFakeKycClient());
    for (const secret of SECRETS) expect(sealed).not.toContain(secret);
  });

  it('keeps the masked value to four digits, which is all a support agent needs', async () => {
    const jobStore = stubStore({
      request: requestRow({ verificationType: 'NIN' }),
      facts: { identifierVerified: true, livenessPassed: true },
    });
    const encryption = testEncryption();
    await runIdentityCheck(
      {
        store: jobStore,
        adapter: createFakeKycClient(),
        hasher: testHasher(),
        encryption,
        gateway: {
          emitToUser: () => {},
          emitToRoom: () => {},
          registerRoomAuthorizer: () => {},
          disconnectUser: () => {},
          connectionCount: () => 0,
        },
        logger: capturingLogger().logger,
      },
      {
        requestId: 'ignored',
        sealed: encryption.encrypt(
          JSON.stringify({ identifier: RAW_PASSING_NIN, firstName: 'A', lastName: 'B' }),
        ),
      },
    );
    expect(jobStore.identityOutcomes[0]?.masked).toBe('*******8904');
  });
});
