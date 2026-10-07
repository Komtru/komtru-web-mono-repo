// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OfflineBanner, QueuedActionNote } from '../../src/index.js';
import './setup.js';

describe('OfflineBanner', () => {
  it('says what is happening and that the data on screen is still the truth as of a moment ago', () => {
    render(
      <OfflineBanner>
        Showing your last saved data — we&apos;ll sync automatically once you&apos;re back.
      </OfflineBanner>,
    );
    expect(screen.getByText("You're offline")).toBeDefined();
    expect(screen.getByText(/Showing your last saved data/)).toBeDefined();
  });

  it('announces itself, because a connection drops without anyone navigating', () => {
    render(<OfflineBanner>Last saved data.</OfflineBanner>);
    expect(screen.getByRole('status').textContent).toContain("You're offline");
  });

  it('draws its own struck-through signal mark rather than taking one from a screen', () => {
    // The banner is the offline banner; its icon never varies, so no screen has to know it.
    const { container } = render(<OfflineBanner>Last saved data.</OfflineBanner>);
    const icon = container.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    // `className` on an SVG element is an `SVGAnimatedString`, not a string.
    expect(icon?.getAttribute('class')).toContain('stroke-warning-on-soft');
  });

  it('lets a screen name the state when "offline" is not the word for it', () => {
    render(<OfflineBanner title="Reconnecting">Hold on.</OfflineBanner>);
    expect(screen.getByText('Reconnecting')).toBeDefined();
  });
});

describe('QueuedActionNote', () => {
  it('names the action and the Trade it belongs to, and says not to tap again', () => {
    render(
      <QueuedActionNote>
        &quot;Confirm delivery&quot; for KMT-88190 is queued — it&apos;ll send the moment your connection
        returns. No need to tap it again.
      </QueuedActionNote>,
    );
    expect(screen.getByRole('status').textContent).toContain('KMT-88190');
  });

  it('is drawn as a dashed note, not a second alert competing with the banner', () => {
    const { container } = render(<QueuedActionNote>One action is queued.</QueuedActionNote>);
    const note = container.firstElementChild;
    expect(note?.className).toContain('border-dashed');
    expect(note?.className).toContain('bg-surface-primary');
  });
});
