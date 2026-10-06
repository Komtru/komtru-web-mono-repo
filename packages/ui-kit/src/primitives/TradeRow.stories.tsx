import type { Meta, StoryObj } from '@storybook/react-vite';
import { TradeRow } from './TradeRow.js';

const meta = {
  title: 'Primitives/TradeRow',
  component: TradeRow,
  args: {
    amount: '₦452,000',
    counterparty: { name: 'TechEdge NG', initials: 'TE' },
    status: { tone: 'protected', label: 'Protected' } as const,
  },
} satisfies Meta<typeof TradeRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** OF1's offline list: amount, state, counterparty, and what is happening. */
export const WithSubline: Story = { args: { sub: 'iPhone 13 Pro · Awaiting shipment' } };

/** Z1's home list: the five-step bar instead of a sub-line. */
export const WithProgress: Story = { args: { stage: 3 } };

export const UnderInspection: Story = {
  args: {
    amount: '₦89,500',
    counterparty: { name: 'Zaza Fashion', initials: 'ZF', tone: 'warning' },
    status: { tone: 'awaiting', label: 'Under Inspection' },
    stage: 4,
  },
};

/** Nowhere to go: the row stays out of the tab order. */
export const NotInteractive: Story = { args: { sub: 'Last synced 6 minutes ago' } };

/** A row that navigates is a link, and takes the keyboard ring. */
export const AsALink: Story = { args: { href: '#trade-88190', stage: 2 } };

export const AList: Story = {
  render: () => (
    <div className="w-[308px]">
      <TradeRow
        amount="₦452,000"
        counterparty={{ name: 'TechEdge NG', initials: 'TE' }}
        status={{ tone: 'protected', label: 'Protected' }}
        stage={3}
        href="#a"
      />
      <TradeRow
        amount="₦89,500"
        counterparty={{ name: 'Zaza Fashion', initials: 'ZF', tone: 'warning' }}
        status={{ tone: 'awaiting', label: 'Under Inspection' }}
        stage={4}
        href="#b"
      />
    </div>
  ),
};
