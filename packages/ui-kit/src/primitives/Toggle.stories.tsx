import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toggle } from './Toggle.js';

const meta = {
  title: 'Primitives/Toggle',
  component: Toggle,
  args: { label: 'Marketing', checked: false },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { checked: true, label: 'Shipment updates' } };

/** C10's "Dispute & fraud alerts — always on, every channel": shown, not hidden, and immovable. */
export const Locked: Story = { args: { checked: true, locked: true, label: 'Dispute & fraud alerts' } };

export const Interactive: Story = {
  render: function Interactive(args) {
    const [checked, setChecked] = useState(false);
    return <Toggle {...args} checked={checked} onChange={setChecked} />;
  },
};

/** C10's settings group, which is the only place the switch appears. */
export const InASettingsRow: Story = {
  render: function InASettingsRow() {
    const [on, setOn] = useState(true);
    return (
      <div className="w-[308px] overflow-hidden rounded-md border border-solid border-border-hairline bg-surface-primary">
        <div className="flex items-center justify-between gap-[10px] p-[14px]">
          <div>
            <div className="text-[12.5px] font-semibold">Payment protected</div>
            <div className="mt-[1px] text-[10.5px] text-slate">Push + Email</div>
          </div>
          <Toggle label="Payment protected" checked={on} onChange={setOn} />
        </div>
        <div className="flex items-center justify-between gap-[10px] border-t border-solid border-border-hairline p-[14px]">
          <div>
            <div className="text-[12.5px] font-semibold">Dispute &amp; fraud alerts</div>
            <div className="mt-[1px] text-[10.5px] text-slate">Always on, every channel</div>
          </div>
          <Toggle label="Dispute & fraud alerts" checked locked />
        </div>
      </div>
    );
  },
};
