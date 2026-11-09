import type { Meta, StoryObj } from '@storybook/react-vite';
import { CountdownStrip } from './CountdownStrip.js';

const meta = {
  title: 'Primitives/CountdownStrip',
  component: CountdownStrip,
  args: { children: 'Inspection ends · 2 Oct, 13:24' },
} satisfies Meta<typeof CountdownStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Deadline: Story = {};
