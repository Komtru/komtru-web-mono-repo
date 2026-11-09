import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoCard, InfoRow } from './InfoCard.js';

const meta = {
  title: 'Primitives/InfoCard',
  component: InfoCard,
  args: { children: null },
} satisfies Meta<typeof InfoCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.logistics-card`: plain facts, then links to the detail behind them. */
export const Rows: Story = {
  render: () => (
    <InfoCard aria-label="Trade details">
      <InfoRow title="Waybill" detail="KT-883192" />
      <InfoRow title="Agreement" detail="Accepted terms and version history" href="#terms" />
      <InfoRow title="Activity" detail="What happened, who acted and when" href="#activity" />
    </InfoCard>
  ),
};
