// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Banner, type BannerTone } from '../../src/index.js';
import './setup.js';

const SURFACES: Record<BannerTone, string> = {
  info: 'bg-trust-indigo-soft',
  warning: 'bg-warning-soft',
  success: 'bg-success-soft',
  risk: 'bg-risk-soft',
};

describe('Banner', () => {
  it.each(Object.keys(SURFACES) as BannerTone[])('fills with the %s soft surface', (tone) => {
    const { container } = render(<Banner tone={tone}>You are offline.</Banner>);
    expect(container.firstElementChild?.className).toContain(SURFACES[tone]);
  });

  it('states the headline in the tone’s on-soft colour, which is what the reference reads', () => {
    render(
      <Banner tone="warning" title="Accept is locked">
        Attach a photo first.
      </Banner>,
    );
    expect(screen.getByText('Accept is locked').className).toContain('text-warning-on-soft');
  });

  it('is a polite status by default and an alert when something is at risk', () => {
    const { unmount } = render(<Banner tone="warning">You are offline.</Banner>);
    expect(screen.getByRole('status')).toBeDefined();
    unmount();
    render(<Banner tone="risk">This Trade is under dispute.</Banner>);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('tints its icon to match, without announcing it twice', () => {
    const { container } = render(
      <Banner tone="success" icon={<svg viewBox="0 0 24 24" />}>
        Ready to accept.
      </Banner>,
    );
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon?.className).toContain('text-success-on-soft');
  });

  it('reads the quiet info note at 11.5px and fully opaque, not the alert banner’s dimmed 11px', () => {
    render(<Banner tone="info">Nothing is funded until both sides accept.</Banner>);
    const body = screen.getByText('Nothing is funded until both sides accept.');
    expect(body.className).toContain('text-[11.5px]');
    expect(body.className).toContain('leading-[1.5]');
    expect(body.className).not.toContain('opacity-[.8]');
  });

  it('dims the alert banners’ body the way the reference does', () => {
    render(<Banner tone="warning">Attach a photo first.</Banner>);
    const body = screen.getByText('Attach a photo first.');
    expect(body.className).toContain('text-[11px]');
    expect(body.className).toContain('opacity-[.8]');
  });

  it('draws the info note’s 15px icon and the alert banners’ 16px one', () => {
    const icon = <svg viewBox="0 0 24 24" />;
    const note = render(
      <Banner tone="info" icon={icon}>
        Compare before you release.
      </Banner>,
    );
    expect(note.container.querySelector('[aria-hidden="true"]')?.className).toContain('h-[15px]');
    note.unmount();
    const alert = render(
      <Banner tone="warning" icon={icon}>
        Accept is locked.
      </Banner>,
    );
    expect(alert.container.querySelector('[aria-hidden="true"]')?.className).toContain('h-[16px]');
  });

  it('reads without a headline, which is how the scope notes are written', () => {
    render(<Banner tone="info">Nothing is funded until both sides accept the terms.</Banner>);
    expect(screen.getByText('Nothing is funded until both sides accept the terms.')).toBeDefined();
  });
});
