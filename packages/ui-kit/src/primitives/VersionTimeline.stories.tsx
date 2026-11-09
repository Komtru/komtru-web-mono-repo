import type { Meta, StoryObj } from '@storybook/react-vite';
import { VersionTimeline } from './VersionTimeline.js';

const meta = {
  title: 'Primitives/VersionTimeline',
  component: VersionTimeline,
  args: { steps: [] },
} satisfies Meta<typeof VersionTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** TC-06's `.m-step` history. */
export const Versions: Story = {
  args: {
    'aria-label': 'Versions of this agreement',
    steps: [
      { id: '1', title: 'Version 1', detail: 'Superseded', state: 'done' },
      { id: '2', title: 'Version 2 · Accepted', detail: 'Current agreed version', state: 'done' },
      { id: '3', title: 'Funded', state: 'pending' },
    ],
  },
};
