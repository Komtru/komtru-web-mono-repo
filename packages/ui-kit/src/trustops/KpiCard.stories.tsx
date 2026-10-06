import type { Meta, StoryObj } from '@storybook/react-vite';
import { KpiCard } from './KpiCard.js';

const meta = {
  title: 'TrustOps/KpiCard',
  component: KpiCard,
  parameters: {
    docs: {
      description: {
        component:
          'One number, its label and a trend line. The value is mono so a column of them lines up ' +
          'and so a reviewer can quote it back exactly.',
      },
    },
  },
  args: { label: 'Period intake', value: '342', trend: { text: '+14.7% vs prior', tone: 'up' } },
} satisfies Meta<typeof KpiCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rising: Story = {};
export const Flagged: Story = {
  args: { label: 'Parcels held now', value: '12', trend: { text: '3 over 24h', tone: 'flag' } },
};
export const Neutral: Story = {
  args: { label: 'Lifetime intake', value: '8,492', trend: { text: 'Since activation' } },
};
export const NoTrend: Story = { args: { label: 'Exceptions', value: '4', trend: undefined } };
export const Money: Story = {
  args: { label: 'Protected', value: '₦48.2m', trend: { text: '1,284 active trades' } },
};

/** TO-PA8 — Hub Detail (reference line 8295): four cards, one row. */
export const HubDetailRow: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-[14px] md:grid-cols-4">
      <KpiCard label="Parcels held now" value="12" trend={{ text: '3 over 24h', tone: 'flag' }} />
      <KpiCard label="Period intake" value="342" trend={{ text: '+14.7% vs prior', tone: 'up' }} />
      <KpiCard label="Lifetime intake" value="8,492" trend={{ text: 'Since activation' }} />
      <KpiCard label="Successful releases" value="329" trend={{ text: '96.2% of intake', tone: 'up' }} />
    </div>
  ),
};
