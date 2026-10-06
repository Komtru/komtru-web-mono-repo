import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './Card.js';

const meta = { title: 'Primitives/Card', component: Card } satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The generic panel: `.logistics-card`, `.m-profile-card`, `.fee-summary`. */
export const Stack: Story = {
  args: {
    children: (
      <>
        <div className="text-[14px] font-semibold">Protection terms</div>
        <div className="mt-[6px] text-[11px] text-slate">24-hour inspection window — Electronics</div>
      </>
    ),
  },
};

/** `.item-card` — thumbnail beside copy, the shape every trade detail opens with. */
export const Row: Story = {
  args: {
    layout: 'row',
    children: (
      <>
        <div className="h-[64px] w-[64px] shrink-0 rounded-[10px] bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]" />
        <div>
          <div className="text-[14px] font-semibold">MacBook Air M2</div>
          <div className="mt-[2px] text-[11px] text-slate">₦980,000.00 · Bola O.</div>
        </div>
      </>
    ),
  },
};
