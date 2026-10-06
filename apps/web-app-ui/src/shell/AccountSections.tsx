import { SettingsGroup, SettingsRow } from '@komtru/ui-kit';
import { accountItemsFor, type AccountLinks, type Viewer } from './nav';

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
  const own = items.filter((item) => item.id !== 'payouts' && item.id !== 'park-agent');
  const earned = items.filter((item) => item.id === 'payouts' || item.id === 'park-agent');

  return (
    <div className="max-w-[480px]">
      <SettingsGroup label="Your account">
        {own.map((item) => (
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
    </div>
  );
}
