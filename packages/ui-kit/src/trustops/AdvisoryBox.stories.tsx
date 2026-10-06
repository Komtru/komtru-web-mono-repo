import type { Meta, StoryObj } from '@storybook/react-vite';
import { AdvisoryBox } from './AdvisoryBox.js';

const meta = {
  title: 'TrustOps/AdvisoryBox',
  component: AdvisoryBox,
  parameters: {
    docs: {
      description: {
        component:
          'The advisory half of a decision surface. A named `region` landmark, prose only: its ' +
          'children are typed `string`, so an action cannot be rendered inside it.',
      },
    },
  },
  args: {
    children:
      'Unverified number plus first-Trade amount 34x the median matches the pattern behind 70% of ' +
      'proposals later confirmed as social-engineering attempts. Suggest: require phone ' +
      'verification before this reaches the seller.',
  },
} satisfies Meta<typeof AdvisoryBox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** N2 — Trade Proposal Review (reference line 3622). */
export const ProposalReview: Story = {};

/** TO-PA2 — Park Hub application review (reference line 8877). */
export const ApplicationReview: Story = {
  args: {
    children:
      'Identity and hub details are consistent. Authority evidence is the only material gap. ' +
      'Suggest: request staff ID or management letter before activation.',
  },
};

/** Several findings read better as separate paragraphs than as one block. */
export const SeveralParagraphs: Story = {
  args: {
    children: [
      'One failed PIN attempt with no prior incidents on this hub.',
      'Suggest: keep the parcel held, notify the buyer to retrieve the current PIN, and monitor ' +
        'for another attempt.',
    ],
  },
};

/** The label is overridable for a non-AI source — a policy engine, a partner's risk score. */
export const PolicyEngineSource: Story = {
  args: {
    label: 'Policy-engine suggestion — not a decision',
    children: 'Amount exceeds the new-merchant ceiling by ₦1.2m. Suggest: hold for manual review.',
  },
};
