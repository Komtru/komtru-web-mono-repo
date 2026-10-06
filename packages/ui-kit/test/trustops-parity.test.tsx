/**
 * Every TrustOps pattern is checked against the rule the reference HTML declares for it, by the
 * same runner `primitives-parity.test.tsx` uses: render, harvest the `class` attributes, compile
 * them through the real Tailwind preset, diff the declarations both ways. A property a component
 * does not reproduce has to be named in `DEVIATIONS` with a reason; a property it adds has to be
 * named in `ADDITIONS`; an entry in either that no longer applies fails too.
 *
 * Node, not jsdom — see `parity-harness.tsx`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AdvisoryBox,
  CaseLayout,
  DataTable,
  DecisionPanel,
  EvidenceMatrix,
  FilterBar,
  KpiCard,
  PeriodFilter,
  PolicyCite,
  Timeline,
  TrustTrail,
} from '../src/index.js';
import { REFERENCE_FILE } from '../scripts/extract-tokens.js';
import { type Additions, type Deviations, type ParityRow, describeParity } from './parity-harness.js';
import { baseUtility, compiledDeclarations, referenceRule } from './reference-css.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '../../../docs/design-reference', REFERENCE_FILE), 'utf8');

/**
 * The reference restates `.p0-timeline` three times at three scales — a shrunken preview in
 * `komtru-p0-architecture-v3`, the real thing in `komtru-unified-ds-v4`, and a third pass in
 * `komtru-canonical-desktop-v5`. `Timeline` reproduces the unified design system's, and names it
 * here so the choice is explicit rather than whichever copy the merge happened to end on.
 */
const UNIFIED = 'komtru-unified-ds-v4';

const ADVICE = 'Suggest: require phone verification before this reaches the seller.';
const POLICY = { policy: 'New-Buyer Proposal Policy', section: '2.1' } as const;

const EVENTS = [
  { id: '1', title: 'Parcel received', detail: '10 Sep · 14:21 · Jibowu Hub recorded custody intake.' },
];

const EVIDENCE = [
  { id: 'identity', label: 'Identity', detail: 'National ID · name match · verified', state: 'pass' },
  { id: 'authority', label: 'Park authority', detail: 'Staff authority not yet proven', state: 'gap' },
  { id: 'payout', label: 'Payout', detail: 'Account-name match required', state: 'check' },
] as const;

const decisionPanel = (
  <DecisionPanel advisory={ADVICE} actions={<button type="button">Approve</button>} policy={POLICY} />
);

const caseLayout = (
  <CaseLayout
    caseId="KMT-90138 · Proposed 8 minutes ago"
    subject="Unusually large first-time proposal"
    parties="Unverified number (buyer) → Prime Gadgets (seller) · ₦1,450,000"
    evidence={<p>evidence</p>}
    decision={<p>decision</p>}
  />
);

const dataTable = (
  <DataTable
    caption="Trade Proposals"
    columns={[
      { key: 'code', header: 'Trade Code', variant: 'mono', render: () => 'KMT-90142' },
      { key: 'amount', header: 'Amount', variant: 'amount', render: () => '₦89,500' },
    ]}
    rows={[{ code: 'KMT-90142' }]}
    rowKey={(row) => row.code}
    footer={<span>3 of 6 flagged proposals</span>}
  />
);

const filterBar = (
  <FilterBar
    search={{ label: 'Search proposals', placeholder: 'Search by Trade Code' }}
    chips={[
      { id: 'flagged', label: 'Flagged (6)', active: true },
      { id: 'cleared', label: 'Cleared (204)' },
    ]}
  />
);

const periodFilter = <PeriodFilter value="week" onChange={() => undefined} />;

const DEVIATIONS: Deviations = {
  'case-layout': {
    'grid-template-columns':
      'The reference draws the desktop console only, so `.case-layout` is `1.3fr 1fr` at every ' +
      'width. This package is mobile-first: the base is one column and the two-column grid arrives ' +
      'at `md`, as `md:grid-cols-[1.3fr_1fr]`. The harness skips variant classes, so what it sees ' +
      'is the base. CaseLayout.test.tsx asserts both halves.',
  },
  'p0-event-node': {
    content:
      "The reference draws the node with `::before`, whose `content:''` is what makes a pseudo-" +
      'element exist at all. This package ships no stylesheet and cannot reach a pseudo-element, ' +
      'so the node is a real `aria-hidden` span, which needs no content to exist.',
    'box-shadow':
      'Tailwind routes every shadow through its own `--tw-shadow` composition chain so ring, inset ' +
      'and drop shadows can stack, so the compiled declaration is a variable list rather than the ' +
      "reference's `0 0 0 1px var(--border-hairline)`. The hairline ring reaching it is asserted " +
      'in Timeline.test.tsx.',
  },
};

const ADDITIONS: Additions = {
  // The reference leaves a panel heading's weight to its own `h4` element default. This package
  // ships no element defaults — T-012 deferred them to T-017 — so each heading states its own.
  // `.case-header h4` is the exception: it declares `font-weight:600` itself, and so is not listed.
  'case-resolution-h4': ['font-weight'],
  'timeline-h4': ['font-weight'],
  // The reference strokes each icon directly; here the icon is wrapped in a sized span that carries
  // the colour, so any icon a screen passes inherits it. The wrapper must not shrink in a flex row.
  'ai-label-icon': ['flex-shrink'],
  'policy-cite-icon': ['flex-shrink'],
  // Same wrapper, inside the 28px evidence tile: a `<span>` is inline until it is told otherwise.
  'rq-icon-svg': ['display'],
  // The reference draws the rail and the dots with `::before`. A package with no stylesheet cannot
  // reach a pseudo-element, so they are real positioned elements, and an `<ol>` has to have its
  // marker removed where a `<div>` never had one.
  'p0-timeline': ['list-style-type'],
  // `.search-box` is a `<div>`; wrapping the input in a `<label>` is what removes the need for a
  // generated id, and a label is inline until it is told otherwise.
  'search-box': ['display'],
  // Tailwind has no one-sided border-style utility, so `border-solid` states the style on all four
  // sides where the reference states one. The other three sides are zero-width, so nothing is drawn
  // — but the declaration is real and is named here rather than quietly tolerated.
  'p13-req': ['border-right-style', 'border-bottom-style', 'border-left-style'],
  'p13-audit': ['border-top-style', 'border-right-style', 'border-bottom-style'],
  'data-table-th': ['border-top-style', 'border-right-style', 'border-left-style'],
  'td-mono': ['border-top-style', 'border-right-style', 'border-left-style'],
  'td-amt': ['border-top-style', 'border-right-style', 'border-left-style'],
};

const ROWS: ParityRow[] = [
  { id: 'case-header', selector: '.case-header', element: caseLayout, node: 0 },
  { id: 'case-id', selector: '.case-header .case-id', element: caseLayout, node: 2 },
  { id: 'case-header-h4', selector: '.case-header h4', element: caseLayout, node: 3 },
  { id: 'case-parties', selector: '.case-header .case-parties', element: caseLayout, node: 4 },
  { id: 'case-layout', selector: '.case-layout', element: caseLayout, node: 5 },

  { id: 'case-resolution', selector: '.case-resolution', element: decisionPanel, node: 0 },
  { id: 'case-resolution-h4', selector: '.case-resolution h4', element: decisionPanel, node: 1 },
  {
    id: 'ai-recommend',
    selector: '.ai-recommend',
    element: <AdvisoryBox>{ADVICE}</AdvisoryBox>,
    node: 0,
  },
  {
    id: 'ai-label',
    selector: '.ai-recommend .ai-label',
    element: <AdvisoryBox>{ADVICE}</AdvisoryBox>,
    node: 1,
  },
  {
    id: 'ai-label-icon',
    selector: '.ai-recommend .ai-label svg',
    element: <AdvisoryBox>{ADVICE}</AdvisoryBox>,
    node: 2,
  },
  {
    id: 'ai-recommend-p',
    selector: '.ai-recommend p',
    element: <AdvisoryBox>{ADVICE}</AdvisoryBox>,
    node: 3,
  },
  { id: 'human-decides', selector: '.human-decides', element: decisionPanel, node: 6 },
  { id: 'case-actions', selector: '.case-actions', element: decisionPanel, node: 9 },
  {
    id: 'policy-cite',
    selector: '.policy-cite',
    element: <PolicyCite {...POLICY} />,
    node: 0,
  },
  {
    id: 'policy-cite-icon',
    selector: '.policy-cite svg',
    element: <PolicyCite {...POLICY} />,
    node: 1,
  },

  { id: 'timeline', selector: '.timeline', element: <EvidenceMatrix rows={EVIDENCE} />, node: 0 },
  { id: 'timeline-h4', selector: '.timeline h4', element: <EvidenceMatrix rows={EVIDENCE} />, node: 1 },
  { id: 'p13-req', selector: '.p13-req', element: <EvidenceMatrix rows={EVIDENCE} />, node: 3 },
  { id: 'rq-icon', selector: '.p13-req .rq-icon', element: <EvidenceMatrix rows={EVIDENCE} />, node: 4 },
  {
    id: 'rq-icon-svg',
    selector: '.p13-req .rq-icon svg',
    element: <EvidenceMatrix rows={EVIDENCE} />,
    node: 5,
  },
  { id: 'p13-req-b', selector: '.p13-req b', element: <EvidenceMatrix rows={EVIDENCE} />, node: 7 },
  { id: 'p13-req-span', selector: '.p13-req span', element: <EvidenceMatrix rows={EVIDENCE} />, node: 8 },
  {
    id: 'p13-state-ready',
    selector: '.p13-state.ready',
    extends: ['.p13-state'],
    element: <EvidenceMatrix rows={EVIDENCE} />,
    node: 9,
  },
  {
    id: 'p13-state-hold',
    selector: '.p13-state.hold',
    extends: ['.p13-state'],
    element: <EvidenceMatrix rows={[EVIDENCE[1]]} />,
    node: 9,
  },
  {
    id: 'p13-state-review',
    selector: '.p13-state.review',
    extends: ['.p13-state'],
    element: <EvidenceMatrix rows={[EVIDENCE[2]]} />,
    node: 9,
  },

  {
    id: 'p0-timeline',
    selector: '.p0-timeline',
    styleId: UNIFIED,
    element: <Timeline events={EVENTS} />,
    node: 2,
  },
  { id: 'p0-event', selector: '.p0-event', styleId: UNIFIED, element: <Timeline events={EVENTS} />, node: 4 },
  {
    id: 'p0-event-node',
    selector: '.p0-event:before',
    styleId: UNIFIED,
    element: <Timeline events={EVENTS} />,
    node: 5,
  },
  {
    id: 'p0-event-b',
    selector: '.p0-event b',
    styleId: UNIFIED,
    element: <Timeline events={EVENTS} />,
    node: 6,
  },
  {
    id: 'p0-event-p',
    selector: '.p0-event p',
    styleId: UNIFIED,
    element: <Timeline events={EVENTS} />,
    node: 7,
  },
  { id: 'p13-audit', selector: '.p13-audit', element: <TrustTrail events={EVENTS} />, node: 8 },
  { id: 'p13-audit-b', selector: '.p13-audit b', element: <TrustTrail events={EVENTS} />, node: 9 },
  { id: 'p13-audit-span', selector: '.p13-audit span', element: <TrustTrail events={EVENTS} />, node: 10 },

  { id: 'dash-stat', selector: '.dash-stat', element: <KpiCard label="Period intake" value="342" /> },
  {
    id: 'dlabel',
    selector: '.dash-stat .dlabel',
    element: <KpiCard label="Period intake" value="342" />,
    node: 1,
  },
  {
    id: 'dval',
    selector: '.dash-stat .dval',
    element: <KpiCard label="Period intake" value="342" />,
    node: 2,
  },
  {
    id: 'dtrend',
    selector: '.dash-stat .dtrend',
    element: <KpiCard label="Period intake" value="342" trend={{ text: 'Since activation' }} />,
    node: 3,
  },
  {
    id: 'dtrend-up',
    selector: '.dash-stat .dtrend.up',
    extends: ['.dash-stat .dtrend'],
    element: <KpiCard label="Period intake" value="342" trend={{ text: '+14.7%', tone: 'up' }} />,
    node: 3,
  },
  {
    id: 'dtrend-flag',
    selector: '.dash-stat .dtrend.flag',
    extends: ['.dash-stat .dtrend'],
    element: <KpiCard label="Parcels held" value="12" trend={{ text: '3 over 24h', tone: 'flag' }} />,
    node: 3,
  },

  { id: 'filter-bar', selector: '.filter-bar', element: filterBar, node: 0 },
  { id: 'search-box', selector: '.search-box', element: filterBar, node: 1 },
  { id: 'search-box-icon', selector: '.search-box svg', element: filterBar, node: 3 },
  { id: 'search-box-input', selector: '.search-box input', element: filterBar, node: 4 },
  {
    id: 'filter-chip',
    selector: '.filter-chip',
    element: filterBar,
    node: 7,
  },
  {
    id: 'filter-chip-active',
    selector: '.filter-chip.active',
    extends: ['.filter-chip'],
    element: filterBar,
    node: 6,
  },
  { id: 'period-chip', selector: '.filter-chip', element: periodFilter, node: 3 },
  {
    id: 'period-chip-active',
    selector: '.filter-chip.active',
    extends: ['.filter-chip'],
    element: periodFilter,
    node: 2,
  },

  { id: 'table-wrap', selector: '.table-wrap', element: dataTable, node: 0 },
  { id: 'data-table', selector: 'table.data-table', element: dataTable, node: 1 },
  { id: 'data-table-th', selector: 'table.data-table th', element: dataTable, node: 3 },
  {
    id: 'td-mono',
    selector: 'table.data-table td.mono',
    extends: ['table.data-table td'],
    element: dataTable,
    node: 6,
  },
  {
    id: 'td-amt',
    selector: 'table.data-table td.amt',
    extends: ['table.data-table td'],
    element: dataTable,
    node: 7,
  },
  { id: 'table-foot', selector: '.table-foot', element: dataTable, node: 8 },
];

describe('the TrustOps parity harness', () => {
  it('reads the reference’s own case-review rules', () => {
    expect(referenceRule(html, '.ai-recommend').get('border')).toBe('1px dashed var(--trust-indigo)');
    expect(referenceRule(html, '.human-decides').get('text-align')).toBe('center');
  });

  it('refuses a selector the reference does not declare', () => {
    expect(() => referenceRule(html, '.decision-panel')).toThrow(/declares no rule/);
  });

  it('reads the utility out of a variant class', () => {
    expect(baseUtility('md:grid-cols-[1.3fr_1fr]')).toBe('grid-cols-[1.3fr_1fr]');
    expect(baseUtility('group-last:border-b-0')).toBe('border-b-0');
    // Not a split on every colon: the one inside an arbitrary value is part of the utility.
    expect(baseUtility('bg-[length:200%_100%]')).toBe('bg-[length:200%_100%]');
  });

  /**
   * A variant class is skipped by the comparison, which used to mean a misspelled one was skipped
   * too: `md:grid-colz-[1fr]` and `md:grid-cols-[1.3fr_1fr]` both contributed nothing, so a typo in
   * the class that makes `.case-layout` two columns would have passed parity in silence. The
   * `case-layout` deviation leans on exactly that skip, so the skip has to be the only thing it is.
   */
  it('still refuses a variant class whose utility does not exist', async () => {
    await expect(compiledDeclarations(['md:grid-colz-[1fr]'])).rejects.toThrow(/compiles to no rule/);
    await expect(compiledDeclarations(['hover:bg-red-500'])).rejects.toThrow(/compiles to no rule/);
  });

  it('accepts every variant class this ticket actually emits', async () => {
    for (const variant of [
      'md:grid-cols-[1.3fr_1fr]',
      'first:border-t-0',
      'group-last:border-b-0',
      'hover:bg-surface-secondary',
      'focus-visible:outline-trust-indigo',
    ]) {
      await expect(compiledDeclarations([variant])).resolves.toBeDefined();
    }
  });
});

describeParity({ html, rows: ROWS, deviations: DEVIATIONS, additions: ADDITIONS });
