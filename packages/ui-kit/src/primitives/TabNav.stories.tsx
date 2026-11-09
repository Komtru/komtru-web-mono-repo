import type { Meta, StoryObj } from '@storybook/react-vite';
import { TabNav } from './TabNav.js';

const meta = {
  title: 'Primitives/TabNav',
  component: TabNav,
  args: { items: [], current: '', 'aria-label': 'Trade views' },
} satisfies Meta<typeof TabNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The views of one trade: each its own page, one of them current. */
export const TradeViews: Story = {
  args: {
    current: 'activity',
    items: [
      { id: 'overview', label: 'Overview', href: '#overview' },
      { id: 'terms', label: 'Terms', href: '#terms' },
      { id: 'activity', label: 'Activity', href: '#activity' },
      { id: 'actions', label: 'Actions', href: '#actions' },
    ],
  },
};
