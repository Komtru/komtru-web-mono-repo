import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadFailed } from './LoadFailed.js';

const meta = {
  title: 'Primitives/LoadFailed',
  component: LoadFailed,
  args: {
    title: "Couldn't load the Trade Standards",
    body: 'Check your connection and try again.',
    onRetry: () => undefined,
  },
} satisfies Meta<typeof LoadFailed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** When trying again cannot help. */
export const NoRetry: Story = { args: { onRetry: undefined, title: "Couldn't open this trade" } };
