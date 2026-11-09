import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScreenHeader } from './ScreenHeader.js';

const meta = {
  title: 'Primitives/ScreenHeader',
  component: ScreenHeader,
  args: { title: 'Start Trade', backHref: '/trades' },
} satisfies Meta<typeof ScreenHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.scr-topbar` inside the shell. */
export const Default: Story = {};

export const NoBack: Story = { args: { backHref: undefined, as: 'p' } };
