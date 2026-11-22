'use client';

import { useRequestDataExport } from '@komtru/api-client/react';
import { Button, ReadyBanner, RiskBanner, ScreenHeader, SettingsGroup, SettingsRow } from '@komtru/ui-kit';
import { PERMISSION_WORDS, usePermission } from './permissions';
import { accountProblem } from './words';
import { whenLabel } from '../trade/format';
import { AccountPage } from './AccountPage';

export const PRIVACY_HREF = '/account/privacy';
export const CLOSE_HREF = '/account/close';
/** Asking for the data to be erased closes the account first, so it goes through the same screen. */
export const ERASE_HREF = '/account/close?erase=1';

/**
 * SP-M03: permissions in plain words, and your data kept in your hands. What Komtru can use is what the browser says it
 * can, read and not switched (a page cannot grant itself camera access, and a switch that did nothing would be worse
 * than none). Download my data is the platform's NDPA export request; Delete my data is its erasure request, which
 * closes the account, so it opens the same two screens as closing it.
 */
export function PrivacyScreen(): React.JSX.Element {
  const camera = usePermission('camera');
  const location = usePermission('geolocation');
  const notifications = usePermission('notifications');
  const exportData = useRequestDataExport();

  return (
    <AccountPage
      header={<ScreenHeader title="Privacy & Data" backHref="/account" backLabel="Back to your account" />}
    >
      <SettingsGroup label="What Komtru can use">
        <SettingsRow
          label="Camera"
          sub="To take proof photos and scan Trade Codes"
          control={<State>{PERMISSION_WORDS[camera]}</State>}
        />
        <SettingsRow
          label="Location"
          sub="Only while you use the app"
          control={<State>{PERMISSION_WORDS[location]}</State>}
        />
        <SettingsRow
          label="Notifications"
          sub="Trade updates and security alerts"
          control={<State>{PERMISSION_WORDS[notifications]}</State>}
        />
      </SettingsGroup>
      <p className="mb-[14px] -mt-[6px] text-[11.5px] leading-[1.6] text-trust-gray">
        Change these in your browser’s site settings. Komtru can’t switch them for you.
      </p>
      <SettingsGroup label="Your data">
        <SettingsRow
          label="Download my data"
          sub="A copy of your Trades and details · ready in 24 hours"
          control={
            <Button
              type="button"
              variant="ghost"
              disabled={exportData.isPending}
              onClick={() => exportData.mutate()}
            >
              {exportData.isPending ? 'Asking…' : 'Request'}
              <span className="sr-only"> a copy of my data</span>
            </Button>
          }
        />
        <SettingsRow
          label="Delete my data"
          sub="After you close your account · some records are kept by law"
          href={ERASE_HREF}
        />
      </SettingsGroup>
      {exportData.data !== undefined && (
        <ReadyBanner title={exportData.data.outcome === 'REQUESTED' ? 'We’re on it' : 'You’ve already asked'}>
          {exportData.data.outcome === 'REQUESTED'
            ? `Your copy will be ready by ${whenLabel(exportData.data.dueBy)}.`
            : `Your copy is already being prepared and will be ready by ${whenLabel(exportData.data.dueBy)}.`}
        </ReadyBanner>
      )}
      {exportData.isError && <RiskBanner>{accountProblem(exportData.error, 'export')}</RiskBanner>}
      <SettingsGroup label="Close your account">
        <SettingsRow label="Close my account" sub="You’ll lose access straight away" href={CLOSE_HREF} />
      </SettingsGroup>
      <p className="mt-[6px] text-[11.5px] leading-[1.6] text-trust-gray">
        Komtru never sells your data. Your Trust Passport shows only what you choose to share.
      </p>
    </AccountPage>
  );
}

function State({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="shrink-0 text-[11px] font-semibold text-slate">{children}</span>;
}
