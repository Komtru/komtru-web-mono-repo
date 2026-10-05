import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from './Skeleton.js';

const meta = { title: 'Primitives/Skeleton', component: Skeleton } satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullWidth: Story = {};
export const Narrow: Story = { args: { width: 'w40' } };

/** AB3's placeholder block while a payment is being verified. */
export const Lines: Story = { args: { lines: 3, width: 'w80' } };

export const EveryWidth: Story = {
  render: () => (
    <div className="w-[308px]">
      <Skeleton width="full" className="mb-[8px]" />
      <Skeleton width="w80" className="mb-[8px]" />
      <Skeleton width="w60" className="mb-[8px]" />
      <Skeleton width="w40" />
    </div>
  ),
};
