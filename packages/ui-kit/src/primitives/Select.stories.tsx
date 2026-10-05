import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from './Select.js';

const OPTIONS = [
  { value: 'park', label: 'Park Pickup — Interstate terminal hub' },
  { value: 'door', label: 'Doorstep Delivery' },
];

const meta = {
  title: 'Primitives/Select',
  component: Select,
  args: { label: 'Delivery method', options: OPTIONS },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHelper: Story = {
  args: { helper: 'Park Pickup is the cheaper route between states.' },
};

export const Invalid: Story = {
  args: { label: 'Bank name', invalid: true, helper: 'Pick the bank the payout should land in.' },
};
