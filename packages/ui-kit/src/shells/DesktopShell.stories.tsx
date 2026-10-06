import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../primitives/Button.js';
import { Card } from '../primitives/Card.js';
import { TextField } from '../primitives/TextField.js';
import { DesktopShell } from './DesktopShell.js';
import { AccountIcon, AlertsIcon, PassportIcon, SecurityIcon, VerificationIcon } from './story-icons.js';

const ACCOUNT_NAV = [
  { label: 'Personal Info', icon: AccountIcon, href: '#personal', current: true },
  { label: 'Verification', icon: VerificationIcon, href: '#verification' },
  { label: 'Trust History', icon: PassportIcon, href: '#history' },
  { label: 'Notifications', icon: AlertsIcon, href: '#notifications' },
  { label: 'Security', icon: SecurityIcon, href: '#security' },
];

const meta = {
  title: 'Shells/DesktopShell',
  component: DesktopShell,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DesktopShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Reference screen D9 — the sidebar shell holding Account's own sections. */
export const Account: Story = {
  args: {
    brandLabel: 'Account',
    nav: ACCOUNT_NAV,
    children: (
      <>
        <h4 className="mb-[16px] text-[15px]">Personal Info</h4>
        <div className="max-w-[380px]">
          <TextField label="Full name" defaultValue="Amaka Balogun" />
          <TextField label="Phone number" defaultValue="0802 341 5567" disabled />
          <TextField label="Email (optional)" placeholder="you@example.com" />
          {/* `w-full` is part of `.btn-primary`, and `cx` appends rather than overrides, so the
              shrink-wrap is the parent's job — an inline flex box is as wide as its content. */}
          <span className="inline-flex">
            <Button className="pt-[10px] pr-[22px] pb-[10px] pl-[22px]">Save changes</Button>
          </span>
        </div>
      </>
    ),
  },
};

/** Reference screen T1 — the same shell at tablet width, where the sidebar becomes a top nav. */
export const SellerShopTablet: Story = {
  args: {
    brandLabel: 'TechEdge NG',
    nav: [
      { label: 'Shop', href: '#shop', current: true },
      { label: 'Listings', href: '#listings' },
      { label: 'Payouts', href: '#payouts' },
    ],
    children: (
      <>
        <div className="mb-[16px] grid grid-cols-2 gap-[8px]">
          {[
            { label: 'Available', value: '₦1.2M', trend: 'Ready', tone: 'text-success-on-soft' },
            { label: 'In escrow', value: '₦680K', trend: '3 orders', tone: 'text-warning-on-soft' },
            { label: 'To ship', value: '2', trend: 'Due today', tone: 'text-warning-on-soft' },
            { label: 'Fulfilment', value: '98.7%', trend: '↑ 0.2pt', tone: 'text-success-on-soft' },
          ].map((cell) => (
            <div
              key={cell.label}
              className="rounded-md border-[1px] border-solid border-border-hairline bg-surface-primary p-[11px]"
            >
              <div className="text-[9.5px] tracking-[.03em] text-slate uppercase">{cell.label}</div>
              <div className="mt-[3px] font-mono text-[16px] font-semibold">{cell.value}</div>
              <div className={`mt-[2px] text-[9.5px] font-semibold ${cell.tone}`}>{cell.trend}</div>
            </div>
          ))}
        </div>
        <Card>
          <h4 className="mb-[14px] text-[14px]">Needs attention</h4>
          <p className="text-[12px] text-slate">New request — 4h left</p>
        </Card>
      </>
    ),
  },
};

/** Reference screen T3 — a login page keeps the shell and drops the destinations. */
export const BrandOnly: Story = {
  args: {
    brandLabel: 'Komtru',
    nav: [],
    children: (
      <div className="mx-auto max-w-[320px]">
        <h4 className="mb-[6px] text-[16px]">Welcome back</h4>
        <p className="mb-[18px] text-[12px] text-slate">Log in to check your Trades.</p>
        <TextField label="Phone number" defaultValue="0802 341 5567" />
        <TextField label="Password" type="password" />
        <Button>Log in</Button>
      </div>
    ),
  },
};

/** No destination marked: a screen the navigation does not name. */
export const NoCurrentDestination: Story = {
  args: {
    brandLabel: 'Account',
    nav: ACCOUNT_NAV.map(({ current: _current, ...rest }) => rest),
    children: <p className="text-[12.5px] text-slate">A screen reached from a link in the body.</p>,
  },
};
