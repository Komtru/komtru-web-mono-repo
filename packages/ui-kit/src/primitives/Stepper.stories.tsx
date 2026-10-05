import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stepper } from './Stepper.js';

const STEPS = ['Park Hub', 'Identity', 'Payout', 'Review', 'Submit'];

const meta = {
  title: 'Primitives/Stepper',
  component: Stepper,
  args: { steps: STEPS, current: 0 },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstStep: Story = {};
export const MidWay: Story = { args: { current: 2 } };
export const LastStep: Story = { args: { current: 4 } };

/** Two steps is the shortest the rail reads at. */
export const TwoSteps: Story = { args: { steps: ['Details', 'Review'], current: 1 } };
