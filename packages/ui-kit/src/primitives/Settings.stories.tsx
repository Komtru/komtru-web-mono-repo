import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsGroup } from './Settings.js';
import { SettingsRow } from './Settings.js';
import { Toggle } from './Toggle.js';

const meta = {
  title: 'Primitives/Settings',
  component: SettingsGroup,
  // `children` is supplied by each story's `render`; the arg satisfies the component's own type.
  args: { label: 'Security', children: null },
} satisfies Meta<typeof SettingsGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** C10's security group: one setting, one destination. */
export const Group: Story = {
  render: (args) => (
    <SettingsGroup {...args}>
      <SettingsRow label="Two-factor authentication" control={<Toggle label="Two-factor" checked />} />
      <SettingsRow label="Trusted devices" sub="1 device" href="/account/security/devices" />
    </SettingsGroup>
  ),
};

/** Account's own list (T-110): every row goes somewhere, and one of them leaves the app. */
export const Destinations: Story = {
  args: { label: 'Account', children: null },
  render: (args) => (
    <SettingsGroup {...args}>
      <SettingsRow label="Personal info" href="/account/personal-info" />
      <SettingsRow label="Payouts" sub="For anyone who has sold" href="/account/payouts" />
      <SettingsRow label="Park Agent" sub="Active" href="https://park.komtru.com" external />
    </SettingsGroup>
  ),
};
