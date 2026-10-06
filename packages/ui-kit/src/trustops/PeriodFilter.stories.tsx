import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { KpiCard } from './KpiCard.js';
import { PeriodFilter, type Period } from './PeriodFilter.js';

const meta = {
  title: 'TrustOps/PeriodFilter',
  component: PeriodFilter,
  parameters: {
    docs: {
      description: {
        component:
          'Week, month, quarter, year, custom — a radio group, because exactly one is in force. ' +
          'Lifetime is deliberately not one of them: it is the absence of a window, not a wider ' +
          'one, and it stays readable beside whichever period is selected.',
      },
    },
  },
  args: { value: 'week', onChange: () => undefined },
} satisfies Meta<typeof PeriodFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Arrow keys move inside the group; the group itself is one tab stop. */
export const Interactive: Story = {
  render: function Interactive() {
    const [period, setPeriod] = useState<Period>('week');
    return <PeriodFilter value={period} onChange={setPeriod} />;
  },
};

export const MonthSelected: Story = { args: { value: 'month' } };

/** TO-PA7 — lifetime intake stays all-time while the period drives everything else. */
export const WithLifetimeBeside: Story = {
  render: function WithLifetime() {
    const [period, setPeriod] = useState<Period>('week');
    return (
      <PeriodFilter
        value={period}
        onChange={setPeriod}
        lifetime={{ label: 'Lifetime intake', value: '84,216' }}
      />
    );
  },
};

/** The custom range appears only while `custom` is the choice. */
export const CustomRange: Story = {
  render: function Custom() {
    const [period, setPeriod] = useState<Period>('custom');
    return (
      <PeriodFilter
        value={period}
        onChange={setPeriod}
        customRange={<span className="text-[12px] text-slate">1 Sep – 30 Sep</span>}
      />
    );
  },
};

/** What the control is for: the period drives the period metrics, and nothing else. */
export const DrivingTheMetrics: Story = {
  render: function Driving() {
    const [period, setPeriod] = useState<Period>('week');
    const intake = { week: '342', month: '1,418', quarter: '4,106', year: '16,882', custom: '902' };
    return (
      <div className="flex flex-col gap-[16px]">
        <PeriodFilter
          value={period}
          onChange={setPeriod}
          lifetime={{ label: 'Lifetime intake', value: '84,216' }}
        />
        <div className="grid max-w-[460px] grid-cols-2 gap-[14px]">
          <KpiCard label="Period intake" value={intake[period]} trend={{ text: 'Selected period' }} />
          <KpiCard label="Lifetime intake" value="84,216" trend={{ text: 'Since activation' }} />
        </div>
      </div>
    );
  },
};
