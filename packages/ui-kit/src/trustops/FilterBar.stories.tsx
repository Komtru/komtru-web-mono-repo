import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { FilterBar } from './FilterBar.js';
import { PeriodFilter, type Period } from './PeriodFilter.js';

const CHIPS = [
  { id: 'flagged', label: 'Flagged (6)', active: true },
  { id: 'new-buyer', label: 'New buyer (11)' },
  { id: 'cleared', label: 'Cleared (204)' },
];

const meta = {
  title: 'TrustOps/FilterBar',
  component: FilterBar,
  parameters: {
    docs: {
      description: {
        component:
          'The row above a queue table. The chips are independent toggles — the reference’s ' +
          'queue filters really can all be on at once. One-of-five choices belong in a ' +
          '`PeriodFilter`, which is a radio group.',
      },
    },
  },
  args: {
    search: { label: 'Search proposals', placeholder: 'Search by Trade Code, name, or phone' },
    chips: CHIPS,
  },
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** N1 — Trade Proposal Queue (reference line 3533). */
export const ProposalQueue: Story = {};

export const SearchOnly: Story = { args: { chips: undefined } };

export const ChipsOnly: Story = { args: { search: undefined } };

/** Toggling is the caller's business; this is what it looks like wired up. */
export const Interactive: Story = {
  render: function Interactive() {
    const [active, setActive] = useState<string[]>(['flagged']);
    return (
      <FilterBar
        search={{ label: 'Search proposals', placeholder: 'Search by Trade Code, name, or phone' }}
        chips={CHIPS.map((chip) => ({ ...chip, active: active.includes(chip.id) }))}
        onChipToggle={(id) =>
          setActive((current) =>
            current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
          )
        }
      />
    );
  },
};

/** TO-PA7 — search, period and a status filter on one bar (reference line 8281). */
export const WithAPeriodFilter: Story = {
  render: function WithPeriod() {
    const [period, setPeriod] = useState<Period>('week');
    return (
      <FilterBar search={{ label: 'Search hubs', placeholder: 'Search hub, park, agent or Hub ID' }}>
        <PeriodFilter value={period} onChange={setPeriod} />
      </FilterBar>
    );
  },
};
