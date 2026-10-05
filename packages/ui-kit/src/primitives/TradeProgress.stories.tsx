import type { Meta, StoryObj } from '@storybook/react-vite';
import { TRADE_STAGES, TradeProgress } from './TradeProgress.js';

const meta = {
  title: 'Primitives/TradeProgress',
  component: TradeProgress,
  args: { stage: 3 },
} satisfies Meta<typeof TradeProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shipped: Story = {};
export const Agreement: Story = { args: { stage: 1 } };
export const Released: Story = { args: { stage: 5 } };

/** Inside a dense list, where the labels would crowd the row. */
export const WithoutLabels: Story = { args: { showLabels: false } };

export const EveryStage: Story = {
  render: () => (
    <div className="w-[308px]">
      {TRADE_STAGES.map((stage, index) => (
        <div key={stage} className="mb-[16px]">
          <div className="text-[11px] font-semibold text-slate">{stage}</div>
          <TradeProgress stage={index + 1} />
        </div>
      ))}
    </div>
  ),
};
