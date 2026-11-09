import type { Meta, StoryObj } from '@storybook/react-vite';
import { CounterDiffRow } from './CounterDiffRow.js';

const meta = {
  title: 'Primitives/CounterDiffRow',
  component: CounterDiffRow,
  args: {
    label: 'Item price',
    before: '₦185,000',
    after: '₦195,000',
    beforeCaption: 'buyer proposed',
    afterCaption: 'your counter',
  },
} satisfies Meta<typeof CounterDiffRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** TC-05's `.counter-diff-row`. */
export const Default: Story = {};
