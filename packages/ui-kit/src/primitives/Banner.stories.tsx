import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner } from './Banner.js';
import { AlertIcon, OfflineIcon } from './story-icons.js';

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

/** OF1's `.offline-banner`. */
export const Offline: Story = {
  args: {
    tone: 'warning',
    icon: OfflineIcon,
    title: "You're offline",
    children: "Showing your last saved data — we'll sync automatically once you're back.",
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
