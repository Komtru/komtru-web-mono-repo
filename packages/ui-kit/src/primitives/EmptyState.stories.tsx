import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';
import { BriefcaseIcon } from './story-icons.js';

const meta = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  args: {
    icon: BriefcaseIcon,
    title: 'No protected Trades yet',
    body: 'Start one, or enter a Trade Code from a seller — every completed Trade adds to your Trust Profile.',
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** AC1, verbatim: explain, then the benefit of acting, then the two ways out. */
export const FirstTime: Story = {
  args: {
    action: <Button>Start a Trade</Button>,
    secondaryAction: <Button variant="secondary">Enter a Trade Code</Button>,
  },
};

/** SE2: nothing matched, and the way out is to search differently. */
export const NoResults: Story = {
  args: {
    title: 'Nothing matched that',
    body: 'Try the seller’s phone number, or browse by category instead.',
    action: <Button variant="secondary">Browse categories</Button>,
  },
};

/** `.state-panel.error`: what went wrong, and how to get past it. */
export const Error: Story = {
  args: {
    tone: 'error',
    title: 'We couldn’t load your Trades',
    body: 'Your connection dropped mid-request. Nothing changed — try again.',
    action: <Button>Try again</Button>,
  },
};

export const WithoutAnAction: Story = { args: { action: undefined } };
