import type { Meta, StoryObj } from '@storybook/react-vite';
import { PolicyCite } from './PolicyCite.js';

const meta = {
  title: 'TrustOps/PolicyCite',
  component: PolicyCite,
  parameters: {
    docs: {
      description: {
        component:
          'The footer of every decision: which rule was applied, and which clause of it. Set in ' +
          'the mono face, because a citation has to be quotable.',
      },
    },
  },
  args: { policy: 'New-Buyer Proposal Policy', section: '2.1' },
} satisfies Meta<typeof PolicyCite>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bare: Story = {};

/** N2's own wording — the clause that says the threshold is not case-by-case. */
export const WithTheEvenHandedClause: Story = {
  args: { note: 'same threshold, every case' },
};

/** TO-PA2 points at where the decision is written down. */
export const WritesToTheTrustTrail: Story = {
  args: {
    policy: 'Park Hub Verification Policy',
    section: '1.1',
    note: 'decision is written to the Trust Trail',
  },
};

export const EveryPolicyTheReferenceCites: Story = {
  render: () => (
    <div>
      <PolicyCite policy="New-Buyer Proposal Policy" section="2.1" note="same threshold, every case" />
      <PolicyCite policy="Item Mismatch Policy" section="4.1" note="same policy, every case" />
      <PolicyCite policy="Park Hub Verification Policy" section="1.1" />
      <PolicyCite policy="Velocity & Abuse Policy" section="2.4" />
      <PolicyCite policy="Business Verification Policy" section="1.4" />
    </div>
  ),
};
