import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner } from './Banner.js';
import { AlertIcon } from './story-icons.js';

// OF1's offline banner was a story here until T-110 measured it: `.offline-banner` sets its own
// gap, padding, type sizes and icon size, none of which are `.guard-lock-banner`'s. It is
// `<OfflineBanner>` now — see `Offline.stories.tsx`.
const meta = {
  title: 'Primitives/Banner',
  component: Banner,
  args: { tone: 'warning', children: 'Attach at least one photo or video before you can accept.' },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** W1's `.guard-lock-banner` — the gate, stating what is still missing. */
export const Locked: Story = { args: { icon: AlertIcon, title: 'Accept is locked' } };

/** `.guard-lock-banner.ready` — the same banner once the gate is open. */
export const Ready: Story = {
  args: {
    tone: 'success',
    icon: AlertIcon,
    title: 'Ready to accept',
    children: 'Your proof is attached and timestamped.',
  },
};

/** C4's `.proof-compare-note` — the quiet explanatory note. */
export const Note: Story = {
  args: {
    tone: 'info',
    icon: AlertIcon,
    children: 'Compare the item to the seller’s proof before you release. Both are timestamped.',
  },
};

/** Not in the reference: the risk tone, same geometry with the risk pair. Interrupts. */
export const Risk: Story = {
  args: {
    tone: 'risk',
    icon: AlertIcon,
    title: 'This Trade is under dispute',
    children: 'TrustOps is reviewing it.',
  },
};
