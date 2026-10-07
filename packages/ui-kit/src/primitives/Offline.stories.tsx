import type { Meta, StoryObj } from '@storybook/react-vite';
import { OfflineBanner } from './Offline.js';
import { QueuedActionNote } from './Offline.js';

const meta = {
  title: 'Primitives/Offline',
  component: OfflineBanner,
  args: { children: "Showing your last saved data — we'll sync automatically once you're back." },
} satisfies Meta<typeof OfflineBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** OF1's `.offline-banner`, with the reference's own words. */
export const Banner: Story = {};

/** The pair as OF1 draws them: the banner above the list, the receipt below it. */
export const WithQueuedAction: Story = {
  render: (args) => (
    <div>
      <OfflineBanner {...args} />
      <QueuedActionNote>
        &quot;Confirm delivery&quot; for KMT-88190 is queued — it&apos;ll send the moment your connection
        returns. No need to tap it again.
      </QueuedActionNote>
    </div>
  ),
};
