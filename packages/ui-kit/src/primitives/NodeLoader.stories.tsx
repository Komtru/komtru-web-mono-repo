import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeLoader } from './NodeLoader.js';
import { Skeleton } from './Skeleton.js';

const meta = {
  title: 'Primitives/NodeLoader',
  component: NodeLoader,
  args: { title: 'Verifying payment', body: 'Usually under 30 seconds.' },
} satisfies Meta<typeof NodeLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Nothing stops it saying what it is waiting on, even without a duration. */
export const WithoutDuration: Story = { args: { body: undefined } };

/** AB3, whole: the nodes name the wait, the skeleton holds the shape. */
export const WithSkeleton: Story = {
  render: (args) => (
    <div className="w-[308px]">
      <NodeLoader {...args} />
      <div className="mt-[16px]">
        <Skeleton width="w80" className="mb-[8px]" />
        <Skeleton width="w60" className="mb-[8px]" />
        <Skeleton width="w40" />
      </div>
    </div>
  ),
};
