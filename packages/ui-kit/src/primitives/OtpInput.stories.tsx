import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { OtpInput } from './OtpInput.js';

const meta = {
  title: 'Primitives/OtpInput',
  component: OtpInput,
  args: { label: 'One-time code', value: '' },
} satisfies Meta<typeof OtpInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Controlled by the screen, which is how E3 uses it. Type, paste, or arrow between cells. */
export const Interactive: Story = {
  render: function Interactive(args) {
    const [value, setValue] = useState('');
    return <OtpInput {...args} value={value} onChange={setValue} />;
  },
};

export const Empty: Story = {};

/** E3, mid-entry: three filled, the caret in the fourth. */
export const PartiallyFilled: Story = { args: { value: '482' } };

/** E3b: the whole code is wrong, so the whole code is marked. */
export const WrongCode: Story = { args: { value: '481902', invalid: true } };
