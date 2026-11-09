import type { Meta, StoryObj } from '@storybook/react-vite';
import { ItemCard } from './ItemCard.js';

const meta = {
  title: 'Primitives/ItemCard',
  component: ItemCard,
  args: { title: 'iPhone 13 Pro, 256GB', sub: 'Sierra Blue · Sealed box', price: '₦452,000.00' },
} satisfies Meta<typeof ItemCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** I3, R1 and Customer-2's `.item-card`: the thing being traded. */
export const Default: Story = {};

export const NoCondition: Story = { args: { sub: undefined } };
