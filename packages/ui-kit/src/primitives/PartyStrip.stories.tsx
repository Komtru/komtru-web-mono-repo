import type { Meta, StoryObj } from '@storybook/react-vite';
import { PartyStrip } from './PartyStrip.js';

const meta = {
  title: 'Primitives/PartyStrip',
  component: PartyStrip,
  args: { name: 'TechEdge NG', initials: 'TE', meta: '342 trades' },
} satisfies Meta<typeof PartyStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.seller-strip`. */
export const Default: Story = {};

/** With a destination it is a link and draws the trailing arrow. */
export const Link: Story = { args: { href: '/passport/techedge' } };
