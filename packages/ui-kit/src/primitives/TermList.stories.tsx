import type { Meta, StoryObj } from '@storybook/react-vite';
import { TermList, TermRow } from './TermList.js';

const meta = {
  title: 'Primitives/TermList',
  component: TermList,
  args: { children: null },
} satisfies Meta<typeof TermList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.term-row`s in a description list, as the agreement screens draw the terms of a trade. */
export const Terms: Story = {
  render: () => (
    <TermList aria-label="Terms of this trade">
      <TermRow label="Price" checked>
        ₦452,000.00
      </TermRow>
      <TermRow label="Inspection" checked>
        48 hours <span className="font-semibold text-info-on-soft">· Trade Standard</span>
      </TermRow>
      <TermRow label="Delivery to">5 Adeola Odeku, Victoria Island</TermRow>
    </TermList>
  ),
};
