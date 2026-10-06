// A posting as a caller describes it, and the balance check it has to pass before the database sees
// it. The database is the authority (migration 0017's deferred constraint triggers); this check
// exists so a caller's bug surfaces on the caller's own stack with both sums in hand, rather than
// as a COMMIT failure three statements later with no idea which posting caused it.
import { eventActorSchema, KOBO_MAX, type EventActor, type Kobo } from '@komtru/shared-types';
import { z } from 'zod';
import {
  accountRefSchema,
  currencySchema,
  DEFAULT_CURRENCY,
  ENTRY_DIRECTIONS,
  PAYMENT_PROVIDERS,
  type AccountRef,
  type EntryDirection,
  type PaymentProvider,
} from './accounts.js';

export interface JournalLineInput {
  account: AccountRef;
  direction: EntryDirection;
  /** Kobo, strictly positive: the direction carries the sign. */
  amountMinor: Kobo;
}

/**
 * What a posting is a posting *of*, namespaced by the thing being replayed rather than by the
 * attempt: `charge:<providerReference>`, `trade:<id>:release`, `payout:<id>:initiated`. A retried
 * job reuses the key its first attempt used, and the unique index does the rest.
 */
export const MAX_JOURNAL_LINES = 100;

export const journalIdempotencyKeySchema = z
  .string()
  .min(3)
  .max(200)
  .regex(
    /^[a-z][a-z0-9_]*:[A-Za-z0-9:._-]+$/,
    'An idempotency key is a lower-case namespace, a colon, then what is being posted',
  );

// Strictly positive, and inside the bigint column's range. The direction carries the sign.
const amountSchema = z.bigint().min(1n, 'Amount must be greater than zero').max(KOBO_MAX);

export const journalLineSchema = z.strictObject({
  account: accountRefSchema,
  direction: z.enum(ENTRY_DIRECTIONS),
  amountMinor: amountSchema,
}) satisfies z.ZodType<JournalLineInput, unknown>;

export interface PostJournalInput {
  idempotencyKey: string;
  description: string;
  lines: JournalLineInput[];
  currency?: string;
  /** Soft refs to trade.trades(id) and trade.escrow_action_requests(id). */
  tradeId?: string;
  escrowActionRequestId?: string;
  /** Set together on any posting that represents money crossing a provider boundary (m8 §4). */
  provider?: PaymentProvider;
  providerReference?: string;
  /** 'SYSTEM' or an admin user id as text. */
  createdBy?: string;
  correlationId?: string;
  causationId?: string;
  actor?: EventActor;
}

export const postJournalInputSchema = z
  .object({
    idempotencyKey: journalIdempotencyKeySchema,
    description: z.string().min(1).max(500),
    // `line_count` is a smallint, and no real posting has hundreds of lines; a caller that builds
    // one has a bug, and it should read as a validation error rather than a numeric overflow.
    lines: z
      .array(journalLineSchema)
      .min(2, 'A posting has at least two lines')
      .max(MAX_JOURNAL_LINES, `A posting has at most ${MAX_JOURNAL_LINES} lines`),
    currency: currencySchema.default(DEFAULT_CURRENCY),
    tradeId: z.uuid().optional(),
    escrowActionRequestId: z.uuid().optional(),
    provider: z.enum(PAYMENT_PROVIDERS).optional(),
    providerReference: z.string().min(1).max(200).optional(),
    createdBy: z.string().min(1).max(100).default('SYSTEM'),
    correlationId: z.uuid().optional(),
    causationId: z.uuid().optional(),
    actor: eventActorSchema.optional(),
  })
  .refine(
    (input) => (input.provider === undefined) === (input.providerReference === undefined),
    'A provider and its reference are set together or not at all',
  );

/**
 * A replay that is not a replay. The key is taken by a posting that differs from the one being
 * asked for, so the caller's retry is a different posting wearing the same name: returning the
 * original as a success would leave the wrong money posted and tell the caller it had won.
 */
export class IdempotencyKeyConflictError extends Error {
  readonly code = 'LEDGER_IDEMPOTENCY_CONFLICT';
  constructor(
    readonly idempotencyKey: string,
    readonly difference: string,
  ) {
    super(`Journal entry ${idempotencyKey} already exists and differs: ${difference}`);
    this.name = 'IdempotencyKeyConflictError';
  }
}

export class UnbalancedJournalError extends Error {
  readonly code = 'LEDGER_UNBALANCED';
  constructor(
    readonly debitsMinor: Kobo,
    readonly creditsMinor: Kobo,
  ) {
    super(`Journal entry is unbalanced: debits ${debitsMinor} credits ${creditsMinor}`);
    this.name = 'UnbalancedJournalError';
  }
}

/** Throws unless the lines are at least two and their debits equal their credits. All bigint. */
export function assertBalanced(lines: readonly JournalLineInput[]): void {
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.direction === 'DEBIT') debits += line.amountMinor;
    else credits += line.amountMinor;
  }
  if (lines.length < 2 || debits !== credits) throw new UnbalancedJournalError(debits, credits);
}
