// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TRUST_TRAIL_CAPTION, Timeline, type TimelineEvent, TrustTrail } from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

/** P0-02's custody timeline (reference line 8500). */
const EVENTS: TimelineEvent[] = [
  { id: '1', title: 'Parcel received', detail: '10 Sep · 14:21 · Jibowu Hub recorded custody intake.' },
  { id: '2', title: 'Inspection completed', detail: '10 Sep · 14:38 · Condition recorded, parcel sealed.' },
  {
    id: '3',
    title: 'Release not completed',
    detail: '11 Sep · 09:10 · Recipient PIN challenge failed twice.',
  },
  { id: '4', title: 'Awaiting decision', detail: 'Now · Contact recipient, suspend release or escalate.' },
];

describe('Timeline', () => {
  it('is an ordered list, because the order is the story', () => {
    const { container } = render(
      <main>
        <Timeline events={EVENTS} />
      </main>,
    );
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(container.querySelectorAll('li b')[0]?.textContent).toBe('Parcel received');
  });

  it('draws the rail and the nodes as real hidden elements, since the package ships no stylesheet', () => {
    const { container } = render(<Timeline events={EVENTS} />);
    const rail = container.querySelector('ol > span[aria-hidden="true"]');
    expect(rail?.className).toContain('bg-border-hairline');
    expect(rail?.className).toContain('w-[1px]');
    const nodes = container.querySelectorAll('li > span[aria-hidden="true"]');
    expect(nodes).toHaveLength(4);
    expect(nodes[0]?.className).toContain('bg-trust-indigo');
  });

  it('is a named landmark, and takes its heading level from the page', () => {
    render(
      <main>
        <Timeline events={EVENTS} heading="What we know" headingLevel={3} />
      </main>,
    );
    expect(screen.getByRole('region', { name: 'What we know' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: 'What we know' })).toBeDefined();
  });

  it('renders an event with no detail', () => {
    render(<Timeline events={[{ id: '1', title: 'Case opened' }]} />);
    expect(screen.getByText('Case opened')).toBeDefined();
  });

  it('refuses to render with no events', () => {
    expect(() => render(<Timeline events={[]} />)).toThrow(/no events/);
  });

  it('passes axe', async () => {
    const { container } = render(
      <main>
        <Timeline events={EVENTS} />
      </main>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('TrustTrail', () => {
  it('ships the immutability claim with the record, under the product’s own name', () => {
    render(
      <main>
        <TrustTrail events={EVENTS} />
      </main>,
    );
    expect(screen.getByRole('region', { name: 'Trust Trail' })).toBeDefined();
    expect(screen.getByText(TRUST_TRAIL_CAPTION)).toBeDefined();
    expect(TRUST_TRAIL_CAPTION).toMatch(/immutable/);
  });

  it('marks the caption with the reference’s emerald audit rule', () => {
    const { container } = render(<TrustTrail events={EVENTS} />);
    const caption = container.querySelector('ol + p');
    expect(caption?.className).toContain('border-l-trust-emerald');
    expect(caption?.className).toContain('border-l-[2px]');
  });

  it('takes a case-specific claim, and drops it only when asked explicitly', () => {
    const { rerender, container } = render(<TrustTrail events={EVENTS} caption="Every release is signed." />);
    expect(screen.getByText('Every release is signed.')).toBeDefined();
    rerender(<TrustTrail events={EVENTS} caption="" />);
    expect(container.querySelector('ol + p')).toBeNull();
  });

  it('passes axe', async () => {
    const { container } = render(
      <main>
        <TrustTrail events={EVENTS} />
      </main>,
    );
    await expectNoAxeViolations(container);
  });
});
