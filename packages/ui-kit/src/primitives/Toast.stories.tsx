import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toast } from './Toast.js';

const meta = {
  title: 'Primitives/Toast',
  component: Toast,
  args: { tone: 'info', title: 'Trade Code copied' },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The reference declares no toast and says so: Trade Complete is "a real moment, not just a toast".
 * This is scoped to the small stuff — a copied code, a queued action. Money gets a screen.
 */
export const Info: Story = {};

export const Queued: Story = {
  args: { tone: 'warning', title: 'Queued', body: "It'll send the moment your connection returns." },
};

export const Success: Story = { args: { tone: 'success', title: 'Proof attached' } };

/** Interrupts, because something needs attention now. */
export const Risk: Story = { args: { tone: 'risk', title: "That action couldn't be queued" } };

export const Dismissible: Story = {
  args: { body: 'Share it with the seller to start the Trade.', onDismiss: () => undefined },
};
