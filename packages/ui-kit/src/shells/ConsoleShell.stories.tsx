import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../primitives/Button.js';
import { ConsoleShell } from './ConsoleShell.js';
import {
  AgentsIcon,
  CollapseIcon,
  OverviewIcon,
  QueueIcon,
  SignalsIcon,
  VerificationIcon,
} from './story-icons.js';

const OPS_NAV = [
  { label: 'Overview', icon: OverviewIcon, href: '#overview' },
  { label: 'Dispute Queue', icon: QueueIcon, href: '#disputes' },
  { label: 'Trade Proposals', icon: QueueIcon, href: '#proposals' },
  { label: 'KYB Review', icon: VerificationIcon, href: '#kyb' },
  { label: 'Fraud Signals', icon: SignalsIcon, href: '#fraud' },
  { label: 'Park Agents', icon: AgentsIcon, href: '#park-agents', current: true },
];

const COLLAPSE = (
  <button
    type="button"
    title="Collapse navigation"
    aria-label="Collapse navigation"
    className="flex min-h-[36px] items-center justify-center gap-[10px] rounded-[7px] text-[10px] text-slate hover:bg-surface-secondary lg:justify-start lg:px-[10px]"
  >
    <span
      aria-hidden
      className="inline-flex h-[16px] w-[16px] min-w-[16px] items-center justify-center stroke-current"
    >
      {CollapseIcon}
    </span>
    <span className="hidden lg:inline">Collapse</span>
  </button>
);

const STATS = (
  <div className="grid grid-cols-2 gap-[14px]">
    {[
      { label: 'Active hubs', value: '126', trend: '+8 this quarter', tone: 'text-success-on-soft' },
      { label: 'Parcels held now', value: '418', trend: '37 over 24h', tone: 'text-warning-on-soft' },
    ].map((stat) => (
      <div
        key={stat.label}
        className="rounded-md border-[1px] border-solid border-border-hairline bg-surface-elevated p-[16px]"
      >
        <div className="text-[11px] tracking-[.04em] text-slate uppercase">{stat.label}</div>
        <div className="mt-[6px] font-mono text-[22px] font-semibold">{stat.value}</div>
        <div className={`mt-[4px] text-[11px] font-semibold ${stat.tone}`}>{stat.trend}</div>
      </div>
    ))}
  </div>
);

const meta = {
  title: 'Shells/ConsoleShell',
  component: ConsoleShell,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ConsoleShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Reference screen NAV — the persistent left pane every Desktop TrustOps screen carries. */
export const ParkAgents: Story = {
  args: {
    nav: OPS_NAV,
    navFooter: COLLAPSE,
    title: 'Park Agents',
    description: 'Applications, hubs, custody and agent lifecycle.',
    actions: <Button className="w-auto">+ Register New Park Hub</Button>,
    children: STATS,
  },
};

/** Reference screen TO-PA9 — "same left pane, collapsed to icons; no literal collapse label". */
export const TabletRail: Story = {
  args: {
    nav: OPS_NAV,
    collapsed: true,
    title: 'All Park Hubs',
    description: 'Same shell and information hierarchy at tablet width.',
    actions: <Button className="w-auto">+ Register</Button>,
    children: STATS,
  },
};

/** A screen whose title says everything there is to say. */
export const NoDescription: Story = {
  args: { nav: OPS_NAV, title: 'Fraud Signals', children: STATS },
};
