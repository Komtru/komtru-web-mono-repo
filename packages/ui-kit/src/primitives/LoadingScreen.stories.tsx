import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadingScreen } from './LoadingScreen.js';

const meta = {
  title: 'Primitives/LoadingScreen',
  component: LoadingScreen,
  args: { label: 'Loading the trade' },
} satisfies Meta<typeof LoadingScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
