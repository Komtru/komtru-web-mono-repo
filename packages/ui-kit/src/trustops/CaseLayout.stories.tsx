import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../primitives/Button.js';
import { Chip } from '../primitives/Chip.js';
import { CaseLayout } from './CaseLayout.js';
import { DecisionPanel } from './DecisionPanel.js';
import { EvidenceMatrix } from './EvidenceMatrix.js';
import { Timeline } from './Timeline.js';

/**
 * The reference draws every console screen inside `.dweb-content`: a 1040px frame, white, with 24px
 * of padding. Reproducing that box is what makes `pnpm visual-check --screen N2 --url <this story>`
 * a like-for-like comparison rather than a comparison of two page margins.
 */
function Console({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mx-auto max-w-[1040px] bg-surface-primary p-[24px]">{children}</div>;
}

const meta = {
  title: 'TrustOps/CaseLayout',
  component: CaseLayout,
  parameters: {
    docs: {
      description: {
        component:
          'Identity and risk at the top, evidence left, decision right. Evidence comes first in ' +
          'the DOM as well as on screen — a reviewer should meet what is known before meeting the ' +
          'buttons, and that is the only ordering that survives the columns stacking.',
      },
      story: { inline: true },
    },
    layout: 'fullscreen',
  },
  args: {
    caseId: 'KMT-90138 · Proposed 8 minutes ago',
    subject: 'Unusually large first-time proposal',
    parties: 'Unverified number (buyer) → Prime Gadgets (seller) · ₦1,450,000',
    status: <Chip tone="risk">High Risk</Chip>,
    evidence: (
      <Timeline
        heading="What we know"
        headingLevel={3}
        events={[
          {
            id: '1',
            title: 'Phone number not yet verified',
            detail: 'Signed up 4 minutes before proposing this Trade.',
          },
          {
            id: '2',
            title: 'Amount well outside typical first Trades',
            detail: 'Median first proposal on Komtru: ₦42,000.',
          },
          {
            id: '3',
            title: 'Prime Gadgets has not been notified yet',
            detail: 'Held pending this review — Constitutional Principle VIII.',
          },
        ]}
      />
    ),
    decision: (
      <DecisionPanel
        headingLevel={3}
        advisory={
          'Unverified number plus first-Trade amount 34x the median matches the pattern behind 70% ' +
          'of proposals later confirmed as social-engineering attempts. Suggest: require phone ' +
          'verification before this reaches the seller.'
        }
        actions={
          <>
            <Button>Require verification before forwarding</Button>
            <Button variant="secondary">Forward to seller anyway</Button>
            <Button variant="secondary">Block this proposal</Button>
          </>
        }
        policy={{
          policy: 'New-Buyer Proposal Policy',
          section: '2.1',
          note: 'same threshold, every case',
        }}
        footnote={
          'This never implies the buyer is dishonest — only that Komtru’s own verification hasn’t ' +
          'caught up with the size of what they’re proposing yet.'
        }
      />
    ),
  },
} satisfies Meta<typeof CaseLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** N2 — Trade Proposal Review (reference line 3581), assembled from this package only. */
export const ProposalReview: Story = {
  render: (args) => (
    <Console>
      <CaseLayout {...args} />
    </Console>
  ),
};

/** TO-PA2 — Application Review (reference line 8855): the evidence matrix in the left column. */
export const ApplicationReview: Story = {
  render: (args) => (
    <Console>
      <CaseLayout {...args} />
    </Console>
  ),
  args: {
    caseId: 'PH-10482 · Submitted 3h ago · SLA 21h remaining',
    subject: 'Jibowu Park Hub — God is Good Motors',
    parties: 'Agent: Chidi O. · Lagos Mainland · Primary operator',
    // The reference draws no owner action on this screen, only the lifecycle badge. `NoOwnerActions`
    // and `ProposalReview` cover the other two shapes.
    status: <Chip tone="awaiting">Verifying</Chip>,
    evidence: (
      <EvidenceMatrix
        headingLevel={3}
        rows={[
          { id: 'identity', label: 'Identity', detail: 'National ID · name match · verified', state: 'pass' },
          {
            id: 'authority',
            label: 'Park authority',
            detail: 'Counter photo · signage match · staff authority not yet proven',
            state: 'gap',
          },
          {
            id: 'hub',
            label: 'Hub details',
            detail: 'Address, terminal, phone and operating hours supplied',
            state: 'pass',
          },
          {
            id: 'payout',
            label: 'Payout',
            detail: 'GTBank •••• 5567 · account-name match required',
            state: 'check',
          },
        ]}
      />
    ),
    decision: (
      <DecisionPanel
        heading="TrustOps decision"
        headingLevel={3}
        advisory={
          'Identity and hub details are consistent. Authority evidence is the only material gap. ' +
          'Suggest: request staff ID or management letter before activation.'
        }
        actions={
          <>
            <Button>Approve &amp; activate</Button>
            <Button variant="secondary">Request specific evidence</Button>
            <Button variant="secondary">Reject application</Button>
          </>
        }
        policy={{
          policy: 'Park Hub Verification Policy',
          section: '1.1',
          joiner: '·',
          note: 'decision is written to the Trust Trail',
        }}
      />
    ),
  },
};

/** Without a status chip or owner actions, for a case nobody has picked up yet. */
export const NoOwnerActions: Story = { args: { status: undefined, ownerActions: undefined } };
