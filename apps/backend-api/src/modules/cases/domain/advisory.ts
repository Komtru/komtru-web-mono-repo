// The advisory (T-107, Q9 default): a suggestion with its reasons, for a human who decides.
//
// v1 is rules, one set per case type, behind an interface so an LLM-backed provider can replace it
// without touching a caller. What matters more than the rules is the shape of the contract:
//
//  - the output is a SUGGESTION, always labelled; it has no outcome, reason or citation field of
//    the kind a decision has, so it cannot be mistaken for one or stored as one;
//  - this file imports no schema and no writer. The service that serves it holds a read-only handle.
//    "A decision can never be recorded by the advisory path" is a property of what the path can reach.
import type { CaseFacts, CasePriority, CaseState, CaseType } from './types.js';
import type { SlaStatus } from './sla.js';

export const ADVISORY_LABEL = 'AI-suggested — not a decision' as const;

export interface AdvisoryInput {
  type: CaseType;
  state: CaseState;
  priority: CasePriority;
  sla: SlaStatus;
  ageHours: number;
  openEvidenceRequests: number;
  resolvedEvidenceRequests: number;
  priorDecisions: number;
  facts: CaseFacts;
}

export interface Advisory {
  label: typeof ADVISORY_LABEL;
  /** Which provider produced it, so a console can say "rules v1" and an audit can tell them apart. */
  source: string;
  suggestion: string;
  rationale: string[];
}

export interface AdvisoryProvider {
  suggest(input: AdvisoryInput): Promise<Advisory> | Advisory;
}

interface Rule {
  when: (input: AdvisoryInput) => boolean;
  suggestion: string;
  because: (input: AdvisoryInput) => string;
}

const fact = (input: AdvisoryInput, key: string): CaseFacts[string] | undefined => input.facts[key];
const isFalse = (input: AdvisoryInput, key: string): boolean => fact(input, key) === false;
const isTrue = (input: AdvisoryInput, key: string): boolean => fact(input, key) === true;
const atLeast = (input: AdvisoryInput, key: string, n: number): boolean => {
  const value = fact(input, key);
  return typeof value === 'number' && value >= n;
};

/** Checked before the per-type rules, whatever the type. */
const COMMON_RULES: Rule[] = [
  {
    when: (i) => i.openEvidenceRequests > 0,
    suggestion: 'Wait for the outstanding evidence before deciding',
    because: (i) => `${i.openEvidenceRequests} evidence request(s) are still open`,
  },
  {
    when: (i) => i.sla === 'BREACHED' && i.state !== 'ESCALATED',
    suggestion: 'Escalate to a senior reviewer',
    because: () => 'The SLA has been breached',
  },
];

const RULES: Record<CaseType, Rule[]> = {
  DISPUTE: [
    {
      when: (i) => isFalse(i, 'counterpartyResponded'),
      suggestion: 'Chase the counterparty for their response',
      because: () => 'The other party has not yet answered',
    },
    {
      when: (i) => isTrue(i, 'evidenceComplete'),
      suggestion: 'Compare both sides’ evidence and decide',
      because: () => 'Both sides’ evidence is in',
    },
  ],
  KYB: [
    {
      when: (i) => isTrue(i, 'duplicateIdentity'),
      suggestion: 'Confirm the duplicate unless the earlier account is the same person’s abandoned one',
      because: () => 'The same identifier is already verified on another account',
    },
    {
      when: (i) => isFalse(i, 'documentsComplete'),
      suggestion: 'Request the missing business documents',
      because: () => 'The document set is incomplete',
    },
    {
      when: (i) => isFalse(i, 'registryMatch'),
      suggestion: 'Ask the applicant to explain the registry mismatch',
      because: () => 'The registry record does not match the application',
    },
    {
      when: (i) => isTrue(i, 'registryMatch') && isTrue(i, 'documentsComplete'),
      suggestion: 'Approve, subject to your own review of the documents',
      because: () => 'The registry record matches and the documents are complete',
    },
  ],
  MERCHANT_APPLICATION: [
    {
      when: (i) => isFalse(i, 'checklistComplete'),
      suggestion: 'Request the missing items on the certification checklist',
      because: () => 'The checklist is incomplete',
    },
    {
      when: (i) => isTrue(i, 'checklistComplete'),
      suggestion: 'Review the checklist and decide',
      because: () => 'Every checklist item has been supplied',
    },
  ],
  IDENTITY: [
    {
      when: (i) => isTrue(i, 'duplicateIdentity'),
      suggestion: 'Confirm the duplicate unless the earlier account is the same person’s abandoned one',
      because: () => 'The same identifier is already verified on another account',
    },
    {
      when: (i) => isFalse(i, 'nameMatch'),
      suggestion: 'Request a clearer identity document',
      because: () => 'The name on the document does not match the account',
    },
    {
      when: (i) => isFalse(i, 'livenessPassed'),
      suggestion: 'Ask the person to retry the liveness check',
      because: () => 'The liveness check did not pass',
    },
  ],
  FRAUD: [
    {
      when: (i) => atLeast(i, 'signalCount', 3),
      suggestion: 'Escalate to a senior fraud analyst',
      because: (i) => `${String(fact(i, 'signalCount'))} independent risk signals are attached`,
    },
    {
      when: (i) => atLeast(i, 'signalCount', 1),
      suggestion: 'Review the attached signals before any restriction',
      because: () => 'At least one risk signal is attached',
    },
  ],
  CUSTODY: [
    {
      when: (i) => atLeast(i, 'heldHours', 48),
      suggestion: 'Escalate to the hub operator and confirm the parcel’s state',
      because: (i) => `The parcel has been held ${String(fact(i, 'heldHours'))} hours`,
    },
  ],
  PAYMENT_EXCEPTION: [
    {
      when: (i) => isTrue(i, 'ledgerMismatch'),
      suggestion: 'Escalate to finance for a ledger reconciliation',
      because: () => 'The provider record and the ledger disagree',
    },
  ],
  TRADE_PROPOSAL: [
    {
      when: (i) => isTrue(i, 'riskHold'),
      suggestion: 'Review the proposer’s history before releasing the hold',
      because: () => 'A risk rule placed this proposal on hold',
    },
  ],
  PARK_HUB_APPLICATION: [
    {
      when: (i) => isFalse(i, 'siteVisitDone'),
      suggestion: 'Schedule the site audit',
      because: () => 'No site visit has been recorded',
    },
  ],
};

export const RULES_SOURCE = 'RULES_V1';

const FALLBACK = 'Review the case file; no automated suggestion applies';

export const ruleBasedAdvisory = {
  suggest(input: AdvisoryInput): Advisory {
    const rules = [...COMMON_RULES, ...RULES[input.type]];
    const matched = rules.filter((rule) => rule.when(input));
    const [first] = matched;
    return {
      label: ADVISORY_LABEL,
      source: RULES_SOURCE,
      suggestion: first?.suggestion ?? FALLBACK,
      rationale: first
        ? matched.map((rule) => rule.because(input))
        : ['No rule for this case type matched the facts on record'],
    };
  },
} satisfies AdvisoryProvider;
