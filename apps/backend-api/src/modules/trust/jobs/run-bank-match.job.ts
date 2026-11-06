// The business bank-account name-match (M6 §4's level-3 second requirement; read back by T-073).
//
// This job holds a full NUBAN for the length of one provider call and persists four digits of it
// (§6.5), because M8's `payout_accounts` is the account of record and a second copy here is a second
// thing to leak. Nothing below writes it, logs it or puts it in an event.
import { z } from 'zod';
import { bankAccountHash } from '../domain/identifiers.js';
import { classifyBankMatchFailure, decideBankMatchOutcome } from '../domain/decision.js';
import type { BankMatchJob } from '../domain/queues.js';
import { maskAccountNumber, normaliseAccountNumber } from '../services/bankMatch.service.js';
import { claimRequest, evaluateBusinessLevel, pushOutcome, recordCall, timeProviderCall } from './outcome.js';
import type { TrustJobDeps } from './deps.js';

const claimSchema = z.object({
  accountNumber: z.string().min(1),
  bankCode: z.string().min(1),
  expectedName: z.string().min(1),
});

export async function runBankMatchCheck(deps: TrustJobDeps, data: BankMatchJob): Promise<void> {
  const request = await claimRequest(deps, data.requestId);
  if (!request) return;
  if (request.verificationType !== 'BANK_ACCOUNT_NAME_MATCH') {
    throw new Error(`trust: ${request.verificationType} is not a bank name-match`);
  }

  const claim = claimSchema.parse(JSON.parse(deps.encryption.decrypt(data.sealed)));
  const accountNumber = normaliseAccountNumber(claim.accountNumber);

  if (!(await deps.store.markProviderPending(request.id, deps.adapter.provider))) {
    deps.logger.info(
      { requestId: request.id },
      'trust: the request was decided before the provider was called',
    );
    return;
  }

  const timed = await timeProviderCall(async () =>
    deps.adapter.verifyBankAccountName({
      accountNumber,
      bankCode: claim.bankCode,
      // The CAC-registered name, sealed with the account at submission time — never a name the
      // client typed, which would make the whole check circular.
      expectedName: claim.expectedName,
    }),
  );
  const result = await recordCall(
    deps,
    { requestId: request.id, provider: deps.adapter.provider, callType: 'BANK_ACCOUNT_NAME_MATCH' },
    timed,
  );

  const decision = decideBankMatchOutcome(result);

  /**
   * A PENDING verdict is not an answer, so no `bank_account_name_matches` row is written.
   *
   * The request stays PROVIDER_PENDING for the expiry sweep. A row written now would read back
   * through `findBankNameMatch` as a name-match on record, and `businessFacts` would count it.
   */
  if (decision.requestStatus === 'PROVIDER_PENDING') {
    deps.logger.info(
      { requestId: request.id },
      'trust: the bank name-match is still pending at the provider',
    );
    return;
  }
  const applied = await deps.store.applyBankMatchOutcome({
    request,
    // Four digits, and this is the only place the full number stops travelling.
    accountNumberMasked: maskAccountNumber(accountNumber),
    accountNumberHash: bankAccountHash(deps.hasher, accountNumber),
    bankCode: claim.bankCode,
    ...(result.resolvedAccountName === undefined ? {} : { resolvedAccountName: result.resolvedAccountName }),
    expectedName: claim.expectedName,
    matchResult: result.matchResult,
    ...(result.matchScore === undefined ? {} : { matchScore: result.matchScore }),
    provider: deps.adapter.provider,
    providerReference: result.providerReference,
    requestStatus: decision.requestStatus,
    // A CODE, never the provider's sentence (see run-identity-check.job.ts).
    ...(decision.markVerified ? {} : { rejectionReason: classifyBankMatchFailure(result) }),
  });

  if (!applied) {
    deps.logger.warn(
      { requestId: request.id },
      'trust: the request was decided elsewhere while the provider was answering; outcome discarded',
    );
    return;
  }

  if (decision.markVerified) await evaluateBusinessLevel(deps, request);
  pushOutcome(deps, request, decision.requestStatus, result.verdict);
}
