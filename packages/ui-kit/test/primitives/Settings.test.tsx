// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsGroup, SettingsRow, Toggle } from '../../src/index.js';
import './setup.js';

describe('SettingsGroup', () => {
  it('heads the group the way the reference does, as a heading and not a label in name only', () => {
    render(
      <SettingsGroup label="Security">
        <SettingsRow label="Trusted devices" sub="1 device" href="/account/security" />
      </SettingsGroup>,
    );
    expect(screen.getByRole('heading', { name: 'Security' })).toBeDefined();
  });

  it('keeps its rows in one element, so the first row is the first row either way', () => {
    const { container } = render(
      <SettingsGroup>
        <SettingsRow label="Personal info" href="/account/personal-info" />
      </SettingsGroup>,
    );
    expect(container.querySelector('a')?.className).toContain('first:border-t-0');
  });
});

describe('SettingsRow', () => {
  it('is a link with a chevron when it goes somewhere', () => {
    render(<SettingsRow label="Payouts" sub="2 accounts" href="/account/payouts" />);
    const link = screen.getByRole('link', { name: /Payouts/ });
    expect(link.getAttribute('href')).toBe('/account/payouts');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says where it is going when the destination is another app', () => {
    render(<SettingsRow label="Park Agent" href="https://park.komtru.com" external />);
    expect(screen.getByRole('link', { name: /Park Agent/ }).getAttribute('rel')).toBe('noreferrer');
  });

  it('carries its control instead of a chevron when the row is the setting', () => {
    render(
      <SettingsRow label="Marketing" sub="Off" control={<Toggle label="Marketing" checked={false} />} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Marketing' })).toBeDefined();
  });

  it('shows the state under the label, where the reference puts it', () => {
    render(<SettingsRow label="Park Agent" sub="Application in review" href="/hub/application" />);
    const link = screen.getByRole('link', { name: /Park Agent/ });
    expect(link.textContent).toBe('Park AgentApplication in review');
  });

  it('takes the keyboard ring every other destination in the product has', () => {
    render(<SettingsRow label="Verification" href="/account/verification" />);
    const link = screen.getByRole('link', { name: 'Verification' });
    link.focus();
    expect(document.activeElement).toBe(link);
  });
});
