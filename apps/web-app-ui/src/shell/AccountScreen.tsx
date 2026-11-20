import type { NavItem } from '@komtru/ui-kit';
import { readParkUrl, webAppEnv } from '../app-config';
import { AppShell } from './AppShell';
import { ACCOUNT_ICONS } from './icons';
import { accountItemsFor, type AccountItemId } from './nav';
import { resolveViewer } from './viewer';

/**
 * Account's own frame (D9): the shell with the rail headed "Account" listing the account's sections, under the
 * Account tab. Every section screen uses it, so a section is drawn in the same place as the list it came
 * from. `section` marks the current row in the rail.
 */
export async function AccountScreen({
  section,
  children,
}: {
  section?: AccountItemId;
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const links = { parkUrl: readParkUrl(webAppEnv()) };

  const nav = accountItemsFor(viewer, links).map<NavItem>((item) => ({
    label: item.label,
    href: item.href,
    icon: ACCOUNT_ICONS[item.id],
    ...(item.id === section ? { current: true } : {}),
    // An active agent's row leaves this app for `park.komtru.com`, in the rail as on the row.
    ...(item.external === true ? { external: true } : {}),
  }));

  return (
    <AppShell tab="account" viewer={viewer} nav={{ label: 'Account', items: nav }}>
      {children}
    </AppShell>
  );
}
