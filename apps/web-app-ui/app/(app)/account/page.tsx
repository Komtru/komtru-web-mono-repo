import type { Metadata } from 'next';
import type { NavItem } from '@komtru/ui-kit';
import { readParkUrl, webAppEnv } from '../../../src/app-config';
import { StatusNotice } from '../../../src/account/StatusNotice';
import { AccountSections } from '../../../src/shell/AccountSections';
import { AppShell } from '../../../src/shell/AppShell';
import { ACCOUNT_ICONS } from '../../../src/shell/icons';
import { accountItemsFor } from '../../../src/shell/nav';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Account' };

/**
 * Which rows are here, and what the Park Agent row opens, are facts about the person signed in —
 * so this screen is rendered per request and never prerendered. It is also what keeps the one
 * environment value it needs out of the build.
 */
export const dynamic = 'force-dynamic';

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
  const mode = await resolveMode(viewer);
  const links = { parkUrl: readParkUrl(webAppEnv()) };

  const nav = accountItemsFor(viewer, links).map<NavItem>((item) => ({
    label: item.label,
    href: item.href,
    icon: ACCOUNT_ICONS[item.id],
    // An active agent's row leaves this app for `park.komtru.com`, in the rail as on the row.
    ...(item.external === true ? { external: true } : {}),
  }));

  return (
    <AppShell tab="account" viewer={viewer} mode={mode} nav={{ label: 'Account', items: nav }}>
      <h1 className="mb-[4px] font-display text-[17px] font-semibold md:text-[15px]">Account</h1>
      <p className="mb-[16px] text-[12px] leading-[1.6] text-slate">
        Your details, what Komtru has verified, and how you get paid.
      </p>
      <div className="max-w-[480px]">
        <StatusNotice seller={mode === 'sell'} />
      </div>
      <AccountSections viewer={viewer} links={links} />
    </AppShell>
  );
}
