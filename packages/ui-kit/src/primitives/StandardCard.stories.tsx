import type { Meta, StoryObj } from '@storybook/react-vite';
import { StandardCard } from './StandardCard.js';
import { TermList, TermRow } from './TermList.js';

const meta = {
  title: 'Primitives/StandardCard',
  component: StandardCard,
  args: { title: 'Electronics', children: null },
} satisfies Meta<typeof StandardCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** CTS1's `.terms-summary-card`, one per category. */
export const Electronics: Story = {
  render: (args) => (
    <StandardCard {...args}>
      <TermList>
        <TermRow label="Inspection window">48 hours</TermRow>
        <TermRow label="Seller proof">3 photos</TermRow>
      </TermList>
    </StandardCard>
  ),
};

export const Fashion: Story = {
  args: { title: 'Fashion & Luxury', tone: 'warning' },
  render: Electronics.render,
};
