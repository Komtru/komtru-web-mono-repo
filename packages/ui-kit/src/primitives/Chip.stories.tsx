import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip } from './Chip.js';

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  args: { tone: 'protected', children: 'Protected' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Protected: Story = {};
export const Awaiting: Story = { args: { tone: 'awaiting', children: 'Under Inspection' } };
export const Risk: Story = { args: { tone: 'risk', children: 'Disputed' } };
export const Resolved: Story = { args: { tone: 'resolved', children: 'Resolved' } };
export const Verified: Story = { args: { tone: 'verified', children: 'Identity Verified' } };

/** Without the dot, which is how the reference prints a chip outside a trade row. */
export const WithoutDot: Story = { args: { dot: false, children: 'Protected' } };

export const EveryState: Story = {
  render: () => (
    <div className="flex flex-wrap gap-[8px]">
      <Chip tone="protected">Protected</Chip>
      <Chip tone="awaiting">Under Inspection</Chip>
      <Chip tone="risk">Disputed</Chip>
      <Chip tone="resolved">Resolved</Chip>
      <Chip tone="verified">Identity Verified</Chip>
    </div>
  ),
};
