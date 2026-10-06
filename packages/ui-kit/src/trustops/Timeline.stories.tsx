import type { Meta, StoryObj } from '@storybook/react-vite';
import { Timeline } from './Timeline.js';
import { TrustTrail } from './TrustTrail.js';

const CUSTODY = [
  { id: '1', title: 'Parcel received', detail: '10 Sep · 14:21 · Jibowu Hub recorded custody intake.' },
  {
    id: '2',
    title: 'Inspection completed',
    detail: '10 Sep · 14:38 · Condition recorded and parcel sealed.',
  },
  {
    id: '3',
    title: 'Release not completed',
    detail: '11 Sep · 09:10 · Recipient PIN challenge failed twice.',
  },
  { id: '4', title: 'Case opened', detail: '12 Sep · 08:22 · Automated ageing rule opened a custody case.' },
  {
    id: '5',
    title: 'Awaiting decision',
    detail: 'Now · Determine whether to contact the recipient, suspend release or escalate.',
  },
];

const meta = {
  title: 'TrustOps/Timeline',
  component: Timeline,
  parameters: {
    docs: {
      description: {
        component:
          'The case rail. An ordered list, because the order is the content — "release not ' +
          'completed" before "case opened" is the whole story.',
      },
    },
  },
  args: { events: CUSTODY },
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** P0-02 — Universal Case (reference line 8500). */
export const CaseTimeline: Story = {};

/** N2 uses the same panel for what is known rather than for what happened. */
export const WhatWeKnow: Story = {
  args: {
    heading: 'What we know',
    events: [
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
        detail: 'Held pending this review — Constitutional Principle VIII: protect both sides equally.',
      },
    ],
  },
};

export const OneEvent: Story = {
  args: { events: [{ id: '1', title: 'Case opened', detail: '12 Sep · 08:22 · Automated ageing rule.' }] },
};

/** Titles alone, where the detail is carried elsewhere on the screen. */
export const TitlesOnly: Story = {
  args: { events: CUSTODY.map(({ id, title }) => ({ id, title })) },
};

/** The audit record, under its product name, with the immutability claim attached. */
export const AsATrustTrail: StoryObj<typeof TrustTrail> = {
  render: () => <TrustTrail events={CUSTODY} />,
};

/** A hub-specific claim replaces the general one. */
export const TrustTrailWithItsOwnClaim: StoryObj<typeof TrustTrail> = {
  render: () => (
    <TrustTrail
      events={CUSTODY}
      caption="Every intake, inspection, release and freeze at this hub is an append-only event."
    />
  ),
};
