import type { Meta, StoryObj } from '@storybook/react-vite';
import { EvidenceMatrix } from './EvidenceMatrix.js';

const meta = {
  title: 'TrustOps/EvidenceMatrix',
  component: EvidenceMatrix,
  parameters: {
    docs: {
      description: {
        component:
          'One row per thing that has to be evidenced, each with a state in words: Pass, Gap or ' +
          'Check. TO-PA2 adds this over PH7 so a reviewer can see what is missing without reading ' +
          'the whole file.',
      },
    },
  },
  args: {
    rows: [
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
    ],
  },
} satisfies Meta<typeof EvidenceMatrix>;

export default meta;
type Story = StoryObj<typeof meta>;

/** TO-PA2 — Application Review (reference line 8862). */
export const ApplicationReview: Story = {};

/** Everything settled: the state a reviewer is looking for before activating a hub. */
export const AllPass: Story = {
  args: {
    rows: [
      { id: 'identity', label: 'Identity', detail: 'National ID · name match · verified', state: 'pass' },
      { id: 'authority', label: 'Park authority', detail: 'Management letter on file', state: 'pass' },
      { id: 'payout', label: 'Payout', detail: 'GTBank •••• 5567 · name matched', state: 'pass' },
    ],
  },
};

/** One blocking gap. Everything else is irrelevant until it closes. */
export const OneBlockingGap: Story = {
  args: {
    rows: [
      { id: 'identity', label: 'Identity', detail: 'National ID · name match · verified', state: 'pass' },
      { id: 'cac', label: 'CAC registration', detail: 'Certificate not yet uploaded', state: 'gap' },
    ],
  },
};

/** KYB review uses the same three states against a different set of criteria (AC10). */
export const BusinessVerification: Story = {
  args: {
    heading: 'What we checked',
    rows: [
      { id: 'cac', label: 'CAC registration', detail: 'RC 1482991 · lookup matched', state: 'pass' },
      { id: 'director', label: 'Director ID', detail: 'Government ID · face match pending', state: 'check' },
      {
        id: 'bank',
        label: 'Payout account',
        detail: 'Account name does not match the business',
        state: 'gap',
      },
    ],
  },
};
