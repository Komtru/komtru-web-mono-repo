import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScreenColumn } from './ScreenColumn.js';

const meta = {
  title: 'Primitives/ScreenColumn',
  component: ScreenColumn,
  args: { children: 'A flow screen, centred in the reference column.' },
} satisfies Meta<typeof ScreenColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
