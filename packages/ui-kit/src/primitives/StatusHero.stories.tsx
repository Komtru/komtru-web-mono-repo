import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusHero } from './StatusHero.js';

const meta = {
  title: 'Primitives/StatusHero',
  component: StatusHero,
  args: {
    tone: 'success',
    title: 'Terms agreed',
    children: 'Both parties accepted this version, so the trade has been created.',
  },
} satisfies Meta<typeof StatusHero>;

export default meta;
type Story = StoryObj<typeof meta>;

/** TC-06. */
export const Agreed: Story = {};

/** G3's held state. */
export const Held: Story = {
  args: { tone: 'info', title: 'Held for review', children: "We're checking this before it's forwarded." },
};

export const Rejected: Story = { args: { tone: 'risk', title: "This proposal can't go ahead", as: 'h2' } };
