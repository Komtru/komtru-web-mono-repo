import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeCard } from './CodeCard.js';

const meta = {
  title: 'Primitives/CodeCard',
  component: CodeCard,
  args: { label: 'Trade Code', code: 'KMT-90138' },
} satisfies Meta<typeof CodeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.code-share-card`. */
export const Default: Story = {};
