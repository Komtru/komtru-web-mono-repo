import type { Meta, StoryObj } from '@storybook/react-vite';
import { OptionCard } from './OptionCard.js';

const meta = {
  title: 'Primitives/OptionCard',
  component: OptionCard,
  args: { name: 'role', value: 'BUYER', checked: true, onChange: () => undefined, children: "I'm buying" },
} satisfies Meta<typeof OptionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.reason-option`. */
export const Selected: Story = {};

export const Unselected: Story = {
  args: { checked: false, value: 'SELLER', children: "I'm selling", description: 'You ship the item' },
};

export const Disabled: Story = { args: { checked: false, disabled: true } };
