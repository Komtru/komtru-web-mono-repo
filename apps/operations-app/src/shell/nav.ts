// The console's navigation, as data: the twelve sections of the OP-01 sidebar, each with the
// permission that opens it.
//
// Hiding an item is a courtesy, not the boundary. The backend checks the permission on every call a
// section makes; what this table buys is that a KYC analyst is not shown a Payments section they
// can only be refused. Deny by default: a section with no entry here is not drawn, and an item is
// drawn only when the viewer holds at least one of its permissions.
//
// The mapping is documented, with the reasoning for each row, in `docs/ui-review/T-140/NAV-PERMISSIONS.md`.
import type { PermissionCode } from './permissions';

export const SECTION_IDS = [
  'queue',
  'trades',
  'disputes',
  'identity',
  'risk',
  'hubs',
  'custody',
  'payments',
  'trust-graph',
  'audit',
  'policies',
  'reports',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export interface Section {
  id: SectionId;
  label: string;
  href: string;
  /** What this section is for, in the words a person would use. The placeholder page says it. */
  summary: string;
  /** Any one of these opens the section. */
  permissions: readonly [PermissionCode, ...PermissionCode[]];
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'queue',
    label: 'Work Queue',
    href: '/queue',
    summary: 'Everything waiting for a decision, in one list with the clock on each row.',
    permissions: ['cases.view'],
  },
  {
    id: 'trades',
    label: 'Trades',
    href: '/trades',
    summary: 'Every Trade on the platform, with its proof, its money and who has touched it.',
    permissions: ['trade.view', 'trade.view_all'],
  },
  {
    id: 'disputes',
    label: 'Disputes',
    href: '/disputes',
    summary: 'Disputes and appeals, with the evidence from both sides side by side.',
    permissions: ['dispute.view'],
  },
  {
    id: 'identity',
    label: 'Identity / KYB',
    href: '/identity',
    summary: 'Identity checks, merchant applications and duplicate-identity flags.',
    permissions: ['verification.view', 'merchant.application.view', 'duplicate_flag.view'],
  },
  {
    id: 'risk',
    label: 'Fraud & Risk',
    href: '/risk',
    summary: 'The fraud review queue, restrictions and the signals behind them.',
    permissions: ['risk.view'],
  },
  {
    id: 'hubs',
    label: 'Park Hubs',
    href: '/hubs',
    summary: 'The Park network: hubs, agents and how each one is doing.',
    permissions: ['park.view'],
  },
  {
    id: 'custody',
    label: 'Parcels / Custody',
    href: '/custody',
    summary: 'Parcels in custody, handovers in progress and shipment exceptions.',
    permissions: ['logistics.manage', 'park.view'],
  },
  {
    id: 'payments',
    label: 'Payments / Settlement',
    href: '/payments',
    summary: 'Payments, payouts, settlement batches and reconciliation.',
    permissions: ['payment.view', 'payout.view', 'reconciliation.view'],
  },
  {
    id: 'trust-graph',
    label: 'Trust Graph',
    href: '/trust-graph',
    summary: 'How accounts, devices and Trades connect, for investigating a pattern.',
    permissions: ['risk.view', 'duplicate_flag.view'],
  },
  {
    id: 'audit',
    label: 'Audit / Trust Trail',
    href: '/audit',
    summary: 'The append-only record of who changed access, who looked at what and who decided.',
    permissions: ['audit.view', 'compliance.view'],
  },
  {
    id: 'policies',
    label: 'Policies',
    href: '/policies',
    summary: 'The rules decisions are based on, with versions, and the wording that goes to people.',
    permissions: ['config.view'],
  },
  {
    id: 'reports',
    label: 'Reports',
    href: '/reports',
    summary: 'Reports and analytics, with every export recorded.',
    permissions: ['analytics.view', 'analytics.run_report'],
  },
];

/** The sections a viewer holding `held` is shown, in the sidebar's order. */
export function sectionsFor(held: ReadonlySet<PermissionCode>): readonly Section[] {
  return SECTIONS.filter((section) => section.permissions.some((permission) => held.has(permission)));
}

export const sectionById = (id: SectionId): Section => {
  const section = SECTIONS.find((candidate) => candidate.id === id);
  if (section === undefined) throw new RangeError(`no such section: ${id}`);
  return section;
};

/** Whether a viewer holding `held` may open `id`. The same rule as `sectionsFor`, for a page. */
export const canOpen = (held: ReadonlySet<PermissionCode>, id: SectionId): boolean =>
  sectionById(id).permissions.some((permission) => held.has(permission));

/** Where someone with no permission worth landing on goes: their own account. */
export const ACCOUNT_HREF = '/me';

/** Where `/` goes and where sign-in lands: the first section the viewer may open, else their account. */
export const landingFor = (held: ReadonlySet<PermissionCode>): string =>
  sectionsFor(held)[0]?.href ?? ACCOUNT_HREF;
