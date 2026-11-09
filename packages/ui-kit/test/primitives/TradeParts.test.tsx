// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionStack,
  Chip,
  CodeCard,
  CounterDiffRow,
  CountdownStrip,
  ItemCard,
  OptionCard,
  PartyStrip,
  SectionLabel,
  StandardCard,
  StatusHero,
  TermList,
  TermRow,
  VersionTimeline,
} from '../../src/index.js';
import './setup.js';

describe('ItemCard', () => {
  it('shows the title, the condition line and the price it was given, untouched', () => {
    render(<ItemCard title="iPhone 13 Pro, 256GB" sub="Sierra Blue · Sealed box" price="₦452,000.00" />);
    expect(screen.getByText('iPhone 13 Pro, 256GB')).toBeTruthy();
    expect(screen.getByText('Sierra Blue · Sealed box')).toBeTruthy();
    expect(screen.getByText('₦452,000.00').className).toContain('font-mono');
  });

  it('draws the gradient block until there is a photo, and the photo once there is', () => {
    const { container, rerender } = render(<ItemCard title="Speaker" price="₦1.00" />);
    expect(container.querySelector('img')).toBeNull();
    rerender(<ItemCard title="Speaker" price="₦1.00" imageUrl="https://img.test/a.jpg" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://img.test/a.jpg');
  });
});

describe('PartyStrip', () => {
  it('names the person with their initials and record', () => {
    render(<PartyStrip name="TechEdge NG" initials="TE" meta="342 trades" />);
    expect(screen.getByText('TechEdge NG')).toBeTruthy();
    expect(screen.getByText('342 trades')).toBeTruthy();
    expect(screen.getByText('TE')).toBeTruthy();
  });

  it('is a link, with an arrow, only when it has somewhere to go', () => {
    const { rerender } = render(<PartyStrip name="Ada" initials="AO" />);
    expect(screen.queryByRole('link')).toBeNull();
    rerender(<PartyStrip name="Ada" initials="AO" href="/passport/ada" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/passport/ada');
  });
});

describe('TermList', () => {
  it('pairs each label with its value as a description list', () => {
    render(
      <TermList aria-label="Terms of this trade">
        <TermRow label="Inspection" checked>
          48 hours
        </TermRow>
        <TermRow label="Cancellation">Free before shipment</TermRow>
      </TermList>,
    );
    const list = screen.getByLabelText('Terms of this trade');
    expect(within(list).getByText('Inspection').nextElementSibling?.textContent).toBe('48 hours');
    expect(list.querySelectorAll('svg')).toHaveLength(1);
  });

  it('heads a block with a label in the heading level it is told', () => {
    render(<SectionLabel as="h3">Terms of this trade</SectionLabel>);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Terms of this trade');
  });
});

describe('CounterDiffRow', () => {
  it('says what was and what is, to a screen reader as well as to the eye', () => {
    render(
      <CounterDiffRow
        label="Item price"
        before="₦185,000"
        after="₦195,000"
        beforeCaption="buyer proposed"
        afterCaption="your counter"
      />,
    );
    expect(screen.getByText(/Was:/).parentElement?.textContent).toBe('Was: ₦185,000 — buyer proposed');
    expect(screen.getByText(/Now:/).parentElement?.textContent).toBe('Now: ₦195,000 — your counter');
  });
});

describe('StandardCard', () => {
  it('titles a category and holds its terms', () => {
    render(
      <StandardCard title="Electronics">
        <TermList>
          <TermRow label="Inspection window">48 hours</TermRow>
        </TermList>
      </StandardCard>,
    );
    expect(screen.getByRole('heading', { name: 'Electronics' })).toBeTruthy();
    expect(screen.getByText('48 hours')).toBeTruthy();
  });
});

describe('StatusHero', () => {
  it.each(['success', 'info', 'warning', 'risk'] as const)(
    'is one heading and a paragraph in the %s tone',
    (tone) => {
      render(
        <StatusHero tone={tone} title="Terms agreed">
          Both parties accepted this version.
        </StatusHero>,
      );
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Terms agreed');
      expect(screen.getByText('Both parties accepted this version.')).toBeTruthy();
    },
  );
});

describe('CountdownStrip and CodeCard', () => {
  it('announces the time left as a status', () => {
    render(<CountdownStrip>Respond within 4 hours or this expires</CountdownStrip>);
    expect(screen.getByRole('status').textContent).toContain('Respond within 4 hours');
  });

  it('shows the Trade Code in mono under its label, with room for actions', () => {
    render(
      <CodeCard label="Your Trade Code" code="KMT-90138">
        <button type="button">Copy</button>
      </CodeCard>,
    );
    expect(screen.getByText('KMT-90138').className).toContain('font-mono');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});

describe('VersionTimeline', () => {
  it('is an ordered list of versions with the state each is in', () => {
    render(
      <VersionTimeline
        aria-label="Versions"
        steps={[
          { id: '1', title: 'Version 1 · Buyer proposal', detail: 'Superseded', state: 'done' },
          { id: '2', title: 'Version 2 · Accepted', state: 'active' },
        ]}
      />,
    );
    const items = within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('b')?.textContent)).toEqual([
      'Version 1 · Buyer proposal',
      'Version 2 · Accepted',
    ]);
  });
});

describe('OptionCard', () => {
  it('is a radio in a group: one checked, and choosing another reports its value', () => {
    const onChange = vi.fn();
    render(
      <fieldset>
        <legend>I am</legend>
        <OptionCard name="role" value="BUYER" checked onChange={onChange}>
          Buying
        </OptionCard>
        <OptionCard
          name="role"
          value="SELLER"
          checked={false}
          onChange={onChange}
          description="You ship the item"
        >
          Selling
        </OptionCard>
      </fieldset>,
    );
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Buying/ }).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Selling/ }));
    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0]?.[0] as { target: { value: string } }).target.value).toBe('SELLER');
  });

  it('cannot be chosen when disabled', () => {
    render(
      <OptionCard name="role" value="BUYER" checked={false} onChange={() => undefined} disabled>
        Buying
      </OptionCard>,
    );
    expect(screen.getByRole<HTMLInputElement>('radio').disabled).toBe(true);
  });
});

describe('ActionStack and the verifying chip', () => {
  it('stacks its children in order', () => {
    const { container } = render(
      <ActionStack>
        <button type="button">Accept</button>
        <button type="button">Decline</button>
      </ActionStack>,
    );
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Accept',
      'Decline',
    ]);
  });

  it('draws verifying in the info pair', () => {
    render(<Chip tone="verifying">Verification needed</Chip>);
    expect(screen.getByText('Verification needed').className).toContain('bg-info-soft');
  });
});
