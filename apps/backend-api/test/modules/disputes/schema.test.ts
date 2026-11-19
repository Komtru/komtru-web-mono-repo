// The schema as the code sees it — no database needed. Two things are worth pinning here: that the
// Postgres enums and the domain tuples are the same list (they are built from each other, so this
// catches a bad edit rather than a bad design), and that nothing in this schema holds a real
// foreign key into another module's tables. The second is M3's boundary made checkable.
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  disputeCases,
  disputeDecisionLog,
  disputeEvidence,
  disputeMediationProposals,
  disputeStatusChanges,
} from '../../../src/modules/disputes/infrastructure/postgres/schema/index.js';
import {
  APPEAL_OUTCOMES,
  DECISION_OUTCOMES,
  DECISION_TYPES,
  DISPUTE_CATEGORIES,
  DISPUTE_CREATION_PATHS,
  DISPUTE_STATUSES,
  MEDIATION_PROPOSAL_STATUSES,
} from '../../../src/modules/disputes/domain/types.js';
import {
  appealOutcome,
  decisionOutcome,
  decisionType,
  disputeCategory,
  disputeCreationPath,
  disputeStatus,
  mediationProposalStatus,
} from '../../../src/modules/disputes/infrastructure/postgres/schema/enums.js';

const TABLES = [
  disputeCases,
  disputeEvidence,
  disputeDecisionLog,
  disputeMediationProposals,
  disputeStatusChanges,
];

describe('the schema’s shape', () => {
  it('puts every table in the disputes schema, never in public', () => {
    for (const table of TABLES) {
      expect(getTableConfig(table).schema).toBe('disputes');
    }
  });

  it('keeps cross-module references soft — no real FK leaves this schema', () => {
    const foreign = TABLES.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((fk) => fk.reference().foreignTable),
    );
    for (const target of foreign) {
      expect(getTableConfig(target).schema).toBe('disputes');
    }
  });

  it('cascades every in-schema child off the case it belongs to', () => {
    for (const table of [
      disputeEvidence,
      disputeDecisionLog,
      disputeMediationProposals,
      disputeStatusChanges,
    ]) {
      const keys = getTableConfig(table).foreignKeys;
      expect(keys).toHaveLength(1);
      expect(keys[0]?.onDelete).toBe('cascade');
    }
  });
});

describe('the enums match the domain', () => {
  it.each([
    ['dispute_status', disputeStatus, DISPUTE_STATUSES],
    ['dispute_category', disputeCategory, DISPUTE_CATEGORIES],
    ['dispute_creation_path', disputeCreationPath, DISPUTE_CREATION_PATHS],
    ['decision_outcome', decisionOutcome, DECISION_OUTCOMES],
    ['decision_type', decisionType, DECISION_TYPES],
    ['appeal_outcome', appealOutcome, APPEAL_OUTCOMES],
    ['mediation_proposal_status', mediationProposalStatus, MEDIATION_PROPOSAL_STATUSES],
  ])('%s', (_name, pgEnum, tuple) => {
    expect([...pgEnum.enumValues]).toEqual([...tuple]);
  });
});

describe('the invariants that must be the database’s, not a service’s', () => {
  const indexes = getTableConfig(disputeCases).indexes;

  it('holds "at most one open dispute per trade" as a partial unique index', () => {
    const one = indexes.find((index) => index.config.name === 'dispute_cases_one_active_per_trade');
    expect(one?.config.unique).toBe(true);
    expect(one?.config.where).toBeDefined();
  });

  it('holds "one live mediation proposal per party" the same way', () => {
    const one = getTableConfig(disputeMediationProposals).indexes.find(
      (index) => index.config.name === 'dispute_mediation_one_open_per_party',
    );
    expect(one?.config.unique).toBe(true);
    expect(one?.config.where).toBeDefined();
  });

  it('gives each deadline sweep its own partial index to walk', () => {
    for (const name of [
      'dispute_cases_mediation_due_idx',
      'dispute_cases_evidence_due_idx',
      'dispute_cases_appeal_due_idx',
    ]) {
      expect(indexes.find((index) => index.config.name === name)?.config.where).toBeDefined();
    }
  });

  it('keeps the escrowed total and the decision amounts as bigint, never a float', () => {
    const columns = getTableConfig(disputeCases).columns;
    expect(columns.find((column) => column.name === 'total_escrow_minor')?.getSQLType()).toBe('bigint');
    for (const name of ['amount_to_buyer_minor', 'amount_to_seller_minor']) {
      const column = getTableConfig(disputeDecisionLog).columns.find((c) => c.name === name);
      expect(column?.getSQLType()).toBe('bigint');
    }
  });
});
