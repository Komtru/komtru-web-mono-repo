import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField } from './TextField.js';

const meta = {
  title: 'Primitives/TextField',
  component: TextField,
  args: { label: 'Phone number', placeholder: '080X XXX XXXX' },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHelper: Story = {
  args: { helper: "We'll match the number to the seller's Komtru profile before the proposal is sent." },
};

export const Confirmed: Story = {
  args: { defaultValue: '0802 341 5567', helper: 'Matched to Zaza Fashion', helperTone: 'ok' },
};

export const Invalid: Story = {
  args: { label: 'Account number', defaultValue: '01234', invalid: true, helper: "That isn't 10 digits." },
};

/** `.input.mono-code` — wide-tracked and upper-cased, for a Trade Code. */
export const MonoCode: Story = { args: { label: 'Trade Code', mono: true, defaultValue: 'KMT-88190' } };

export const Password: Story = { args: { label: 'Password', type: 'password', defaultValue: 'komtru' } };
