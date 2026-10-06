import type { Metadata } from 'next';
import type { NavItem } from '@komtru/ui-kit';
import { readWebAppConfig, webAppEnv } from '../../src/app-config';
import { AccountSections } from '../../src/shell/AccountSections';
import { AppShell } from '../../src/shell/AppShell';
import { ACCOUNT_ICONS } from '../../src/shell/icons';
import { accountItemsFor } from '../../src/shell/nav';
import { resolveViewer } from '../../src/shell/viewer';

export const metadata: Metadata = { title: 'Account' };

/**
 * D9 — Account.
 *
 * The reference's own note on it: "Same sidebar+content shell as the seller dashboard — here
 * holding Personal Info, Verification and Trust History as sidebar tabs instead of one long mobile
 * scroll." So inside Account the rail is headed "Account" and lists the account's sections rather
 * than the app's tabs, at every width the rail exists. The tab bar below still marks Account, which
 * is where the person is.
 *
 * The sections themselves are later tickets' screens (T-124 Payouts, T-126 the rest, T-130 the Park
 * Hub application). What this ticket owns is the shell, and which rows are here for whom.
 */
export default async function AccountPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const { parkUrl } = readWebAppConfig(webAppEnv());
  const links = { parkUrl };

  const nav = accountItemsFor(viewer, links).map<NavItem>((item) => ({
    label: item.label,
    href: item.href,
    icon: ACCOUNT_ICONS[item.id],
  }));

  return (
    <AppShell tab="account" viewer={viewer} nav={{ label: 'Account', items: nav }}>
      <h1 className="mb-[4px] font-display text-[17px] font-semibold md:text-[15px]">Account</h1>
      <p className="mb-[16px] text-[12px] leading-[1.6] text-slate">
        Your details, what Komtru has verified, and how you get paid.
      </p>
      <AccountSections viewer={viewer} links={links} />
    </AppShell>
  );
}
