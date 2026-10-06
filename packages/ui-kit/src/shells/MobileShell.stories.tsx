import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner } from '../primitives/Banner.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { OtpInput } from '../primitives/OtpInput.js';
import { StickyFooter } from '../primitives/StickyFooter.js';
import { BriefcaseIcon } from '../primitives/story-icons.js';
import { LogoBar } from './LogoBar.js';
import { MobileShell } from './MobileShell.js';
import { TabBar } from './TabBar.js';
import { TopBar } from './TopBar.js';
import { AccountIcon, AlertsIcon, PassportIcon, TradesIcon } from './story-icons.js';

const TABS = [
  { label: 'Trades', icon: TradesIcon, href: '#trades', current: true },
  { label: 'Passport', icon: PassportIcon, href: '#passport' },
  { label: 'Alerts', icon: AlertsIcon, href: '#alerts' },
  { label: 'Settings', icon: AccountIcon, href: '#settings' },
];

const meta = {
  title: 'Shells/MobileShell',
  component: MobileShell,
  // No bezel and no padding: the shell *is* the page, and the story has to be able to lie about
  // that no more than the app can.
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MobileShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Reference screen E3 — `.scr-topbar` above the body, `.btn-sticky` below it. */
export const VerifyPhone: Story = {
  args: {
    header: <TopBar title="Enter code" back={{ label: 'Back' }} />,
    children: (
      <>
        <h2 className="mb-[6px] text-[17px]">Enter the 6-digit code</h2>
        <p className="mb-[20px] text-[12.5px] text-slate">Sent to 0802 341 5567 via SMS.</p>
        <OtpInput label="One-time code" value="4823" />
        <p className="mb-[20px] text-[11.5px] text-trust-gray">
          Didn&rsquo;t get a code? <span className="font-semibold text-trust-indigo">Resend in 0:24</span>
        </p>
        <Banner tone="info">
          We text this code every time — Komtru never sends payment links by SMS. Treat any link claiming to
          be from us with suspicion.
        </Banner>
      </>
    ),
    footer: (
      <StickyFooter>
        <Button>Verify &amp; continue</Button>
      </StickyFooter>
    ),
  },
};

/** Reference screen AC1 — `.scr-logo-row` above the body, `.scr-tabbar` below it. */
export const TradesEmpty: Story = {
  args: {
    header: <LogoBar action={{ label: 'Alerts', icon: AlertsIcon, href: '#alerts' }} />,
    children: (
      <div className="pt-[8px]">
        <EmptyState
          icon={BriefcaseIcon}
          title="No protected Trades yet"
          body="Start one, or enter a Trade Code from a seller — every completed Trade adds to your Trust Profile."
        />
        {/* AC1 puts the two actions below the panel, not inside it. */}
        <div className="mt-[16px] flex flex-col gap-[8px]">
          <Button>Start a Trade</Button>
          <Button variant="secondary">Enter a Trade Code</Button>
        </div>
      </div>
    ),
    tabs: <TabBar items={TABS} />,
  },
};

/** The bar on its own, with the unread marker the reference draws on the alerts icon. */
export const TopBarWithAction: Story = {
  args: {
    header: (
      <TopBar
        title="My Trades"
        back={{ label: 'Back' }}
        action={{ label: 'Alerts', icon: AlertsIcon, href: '#alerts', badge: true }}
      />
    ),
    children: <p className="text-[12.5px] text-slate">The body scrolls under a bar that does not.</p>,
  },
};

/** A tab the person is not on any of — the shell does not invent a current page. */
export const NoCurrentTab: Story = {
  args: {
    header: <LogoBar />,
    children: <p className="text-[12.5px] text-slate">A detail screen reached from a tab.</p>,
    tabs: <TabBar items={TABS.map(({ current: _current, ...rest }) => rest)} />,
  },
};

/** Nothing in the body: the tab bar still sits at the bottom of the viewport, not under the header. */
export const EmptyBody: Story = {
  args: { header: <LogoBar />, tabs: <TabBar items={TABS} /> },
};
