import { SettingsGroup, SettingsRow } from '@komtru/ui-kit';
import { accountItemsFor, type AccountLinks, type Viewer } from './nav';
import { SignOutRow } from './SignOutRow';

/**
 * D9's sections, as the grouped list the reference builds every account screen out of.
 *
 * Two groups rather than one run of rows, because the split is information: the first five are what
 * every account has, and the second group is what this person has done — sold something, or applied
 * to run a Park Hub. Only the Park Agent row carries a state line, which is the only thing on this
 * screen that changes without the person touching it.
 */
export function AccountSections({
  viewer,
  links,
}: {
  viewer: Viewer;
  links: AccountLinks;
}): React.JSX.Element {
  const items = accountItemsFor(viewer, links);
  const more = ['addresses', 'display', 'refunds', 'statements'];
  const own = items.filter(
    (item) => item.id !== 'payouts' && item.id !== 'park-agent' && !more.includes(item.id),
  );
  const delivery = items.filter((item) => item.id === 'addresses' || item.id === 'display');
  const money = items.filter((item) => item.id === 'refunds' || item.id === 'statements');
  const earned = items.filter((item) => item.id === 'payouts' || item.id === 'park-agent');

  return (
    // From tablet up the groups flow into two balanced columns (DX-37), each kept whole, instead of a phone-width
    // list beside the Account rail.
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] md:columns-2 md:gap-x-[20px] lg:max-w-[920px] [&>*]:break-inside-avoid">
      <SettingsGroup label="Your account">
        {own.map((item) => (
          <SettingsRow key={item.id} label={item.label} href={item.href} />
        ))}
      </SettingsGroup>
      <SettingsGroup label="Delivery and display">
        {delivery.map((item) => (
          <SettingsRow key={item.id} label={item.label} href={item.href} />
        ))}
      </SettingsGroup>
      <SettingsGroup label="Money and documents">
        {money.map((item) => (
          <SettingsRow key={item.id} label={item.label} href={item.href} />
        ))}
      </SettingsGroup>
      <SettingsGroup label="Selling and Park">
        {earned.map((item) => (
          <SettingsRow
            key={item.id}
            label={item.label}
            href={item.href}
            {...(item.status === undefined ? {} : { sub: item.status })}
            {...(item.external === true ? { external: true } : {})}
          />
        ))}
      </SettingsGroup>
      {/*
        Last, and in a group of its own. Leaving the app is not one of the things the account holds
        — it is the way out of it — and a person looking for it expects the bottom of this screen.
      */}
      <SettingsGroup>
        <SignOutRow />
      </SettingsGroup>
    </div>
  );
}
