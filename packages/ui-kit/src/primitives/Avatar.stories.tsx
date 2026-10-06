import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar.js';

const meta = {
  title: 'Primitives/Avatar',
  component: Avatar,
  args: { initials: 'TE', label: 'TechEdge NG' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 34px, the size the reference draws alone. */
export const Default: Story = {};

/** 20px, inside a trade row. */
export const Small: Story = { args: { size: 'sm' } };

/** 44px, on the Trust Passport hero. */
export const Large: Story = { args: { size: 'lg' } };

/** Decoration beside a name that is already on screen — no accessible name at all. */
export const Decorative: Story = { args: { label: undefined } };

export const EveryTone: Story = {
  render: () => (
    <div className="flex items-center gap-[10px]">
      <Avatar initials="TE" label="TechEdge NG" />
      <Avatar initials="ZF" tone="warning" label="Zaza Fashion" />
      <Avatar initials="AB" tone="success" label="Amaka Balogun" />
    </div>
  ),
};
