import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from '../primitives/Avatar.js';
import { Chip } from '../primitives/Chip.js';
import { DataTable } from './DataTable.js';
import { FilterBar } from './FilterBar.js';

interface Proposal {
  code: string;
  buyer: string;
  initials: string;
  seller: string;
  amount: string;
  flag: string;
  status: { label: string; tone: 'awaiting' | 'risk' | 'protected' };
}

/** N1's own rows (reference line 3540). */
const PROPOSALS: Proposal[] = [
  {
    code: 'KMT-90142',
    buyer: 'Amaka B.',
    initials: 'AB',
    seller: 'Zaza Fashion',
    amount: '₦89,500',
    flag: 'First Trade on this account',
    status: { label: 'Awaiting Review', tone: 'awaiting' },
  },
  {
    code: 'KMT-90138',
    buyer: 'Unverified number',
    initials: '?',
    seller: 'Prime Gadgets',
    amount: '₦1,450,000',
    flag: 'Amount far above buyer’s Trade history',
    status: { label: 'High Risk', tone: 'risk' },
  },
  {
    code: 'KMT-90121',
    buyer: 'Tunde A.',
    initials: 'TA',
    seller: 'TechEdge NG',
    amount: '₦452,000',
    flag: 'Verified buyer, routine check',
    status: { label: 'Cleared', tone: 'protected' },
  },
];

const COLUMNS = [
  { key: 'code', header: 'Trade Code', variant: 'mono' as const, render: (row: Proposal) => row.code },
  {
    key: 'buyer',
    header: 'Proposed by',
    render: (row: Proposal) => (
      <span className="flex items-center gap-[6px] text-[12px]">
        <Avatar initials={row.initials} />
        {row.buyer}
      </span>
    ),
  },
  { key: 'seller', header: 'To seller', render: (row: Proposal) => row.seller },
  {
    key: 'amount',
    header: 'Amount',
    variant: 'amount' as const,
    align: 'right' as const,
    render: (row: Proposal) => row.amount,
  },
  {
    key: 'flag',
    header: 'Flag',
    render: (row: Proposal) => <span className="text-[12px] text-slate">{row.flag}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row: Proposal) => <Chip tone={row.status.tone}>{row.status.label}</Chip>,
  },
];

const meta = {
  title: 'TrustOps/DataTable',
  component: DataTable,
  parameters: {
    docs: {
      description: {
        component:
          'A real `<table>` with scoped column headers — the console is the one place in the ' +
          'product where a reader navigates by cell and needs the column announced with the value. ' +
          'The caption is the accessible name and is required.',
      },
    },
  },
  args: {
    caption: 'Trade Proposals',
    columns: COLUMNS,
    rows: PROPOSALS,
    rowKey: (row: Proposal) => row.code,
    footer: <span>3 of 6 flagged proposals</span>,
  },
} satisfies Meta<typeof DataTable<Proposal>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** N1 — Trade Proposal Queue (reference line 3540). */
export const ProposalQueue: Story = {};

/** The caption is hidden by default because the reference draws it as a heading above the frame. */
export const VisibleCaption: Story = { args: { captionVisible: true } };

export const NoFooter: Story = { args: { footer: undefined } };

/** An empty queue keeps its headers: a reviewer should still see what the columns were. */
export const Empty: Story = {
  args: { rows: [], empty: 'No proposals are flagged right now.' },
};

/** The bar and the table together, as every queue screen draws them. */
export const UnderAFilterBar: Story = {
  render: () => (
    <div>
      <FilterBar
        search={{ label: 'Search proposals', placeholder: 'Search by Trade Code, name, or phone' }}
        chips={[
          { id: 'flagged', label: 'Flagged (6)', active: true },
          { id: 'new-buyer', label: 'New buyer (11)' },
          { id: 'cleared', label: 'Cleared (204)' },
        ]}
      />
      <DataTable
        caption="Trade Proposals"
        columns={COLUMNS}
        rows={PROPOSALS}
        rowKey={(row) => row.code}
        footer={<span>3 of 6 flagged proposals</span>}
      />
    </div>
  ),
};
