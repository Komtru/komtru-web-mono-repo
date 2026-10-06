import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';
import { StickyFooter } from './StickyFooter.js';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Start a Trade' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.btn-primary` — the one action a screen is really for. E4, AC1, W1. */
export const Primary: Story = {};

/** `.btn-secondary` — the alternative, never the default. AC1's "Enter a Trade Code". */
export const Secondary: Story = { args: { variant: 'secondary', children: 'Enter a Trade Code' } };

/** `.btn-ghost` — an inline link. E4's "Forgot password?". */
export const Ghost: Story = { args: { variant: 'ghost', children: 'Forgot password?' } };

/** `.btn-danger` — only ever inside a sheet, never a screen's default. CT1. */
export const Danger: Story = { args: { variant: 'danger', children: 'Yes, cancel this Trade' } };

/** Not in the reference: the locked Accept the mandatory-media gate produces. */
export const Disabled: Story = { args: { disabled: true, children: 'Accept trade request' } };

/** `.btn-sticky` — W1's footer, with the screen fading out underneath it. */
export const InAStickyFooter: StoryObj<typeof StickyFooter> = {
  render: () => (
    <div className="flex h-[260px] flex-col bg-surface-secondary">
      <div className="flex-1 p-[16px] text-[12px] text-slate">The screen scrolls behind the footer.</div>
      <StickyFooter>
        <Button>Accept trade request</Button>
        <Button variant="secondary">Propose changes instead</Button>
      </StickyFooter>
    </div>
  ),
};
