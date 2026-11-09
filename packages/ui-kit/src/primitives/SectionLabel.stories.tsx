import type { Meta, StoryObj } from '@storybook/react-vite';
import { SectionLabel } from './SectionLabel.js';

const meta = {
  title: 'Primitives/SectionLabel',
  component: SectionLabel,
  args: { children: 'Terms of this trade' },
} satisfies Meta<typeof SectionLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.scr-label`. */
export const Default: Story = {};
