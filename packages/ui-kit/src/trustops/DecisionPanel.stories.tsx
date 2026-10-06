import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../primitives/Button.js';
import { DecisionPanel } from './DecisionPanel.js';

const meta = {
  title: 'TrustOps/DecisionPanel',
  component: DecisionPanel,
  parameters: {
    docs: {
      description: {
        component:
          'Advisory → "a human decides, always" → actions → policy cite. The advisory is its own ' +
          'landmark and is never inside the action group; the group is described by the divider ' +
          'and the citation, so arriving at the first button announces both.',
      },
    },
  },
  args: {
    advisory:
      'Unverified number plus first-Trade amount 34x the median matches the pattern behind 70% of ' +
      'proposals later confirmed as social-engineering attempts. Suggest: require phone ' +
      'verification before this reaches the seller.',
    actions: (
      <>
        <Button>Require verification before forwarding</Button>
        <Button variant="secondary">Forward to seller anyway</Button>
        <Button variant="secondary">Block this proposal</Button>
      </>
    ),
    policy: { policy: 'New-Buyer Proposal Policy', section: '2.1', note: 'same threshold, every case' },
  },
} satisfies Meta<typeof DecisionPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** N2 — Trade Proposal Review (reference line 3617). */
export const ProposalReview: Story = {};

/** N2 also carries a note that the risk signal is not an accusation. */
export const WithTheReference_sFootnote: Story = {
  args: {
    footnote:
      'This never implies the buyer is dishonest — only that Komtru’s own verification hasn’t ' +
      'caught up with the size of what they’re proposing yet.',
  },
};

/** TO-PA2 — Park Hub application review (reference line 8875). */
export const ApplicationReview: Story = {
  args: {
    heading: 'TrustOps decision',
    advisory:
      'Identity and hub details are consistent. Authority evidence is the only material gap. ' +
      'Suggest: request staff ID or management letter before activation.',
    actions: (
      <>
        <Button>Approve &amp; activate</Button>
        <Button variant="secondary">Request specific evidence</Button>
        <Button variant="secondary">Reject application</Button>
      </>
    ),
    policy: {
      policy: 'Park Hub Verification Policy',
      section: '1.1',
      note: 'decision is written to the Trust Trail',
    },
  },
};

/**
 * Not every case carries a suggestion. With no advisory there is nothing to separate, so the
 * divider goes too — but the citation stays, because the decision still has a rule behind it.
 */
export const NoAdvisory: Story = { args: { advisory: undefined } };

/** A single destructive action still goes in the group, and still cites its clause. */
export const OneAction: Story = {
  args: {
    heading: 'Custody decision',
    advisory: 'One failed PIN attempt with no prior incidents. Suggest: keep the parcel held.',
    actions: <Button variant="danger">Suspend custody rights</Button>,
    policy: { policy: 'Velocity & Abuse Policy', section: '2.4' },
  },
};
