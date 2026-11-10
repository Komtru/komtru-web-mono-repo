// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionStack,
  Chip,
  CodeCard,
  CounterDiffRow,
  CountdownStrip,
  InfoCard,
  InfoRow,
  ItemCard,
  TabNav,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  WarnBanner,
  OptionCard,
  PartyStrip,
  ScreenHeader,
  FileDropzone,
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
  it('can leave the page its one h1 to the screen header', () => {
    render(
      <StatusHero tone="risk" title="Not sent" as="h2">
        It did not pass review.
      </StatusHero>,
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Not sent');
  });

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

describe('CodeCard', () => {
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

describe('ScreenHeader', () => {
  it('is the page heading with a named way back', () => {
    render(<ScreenHeader title="Start Trade" backHref="/browse" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Start Trade');
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/browse');
  });

  it('goes back within the screen when given a handler instead of a place', () => {
    const onBack = vi.fn();
    render(<ScreenHeader title="Bank Transfer" onBack={onBack} backLabel="Back to payment methods" />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to payment methods' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('leaves the heading to the hero when asked, and has no link without a place to go', () => {
    render(<ScreenHeader title="Terms agreed" as="p" />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('FileDropzone locked message', () => {
  it("says what the screen that uses it says, not W1's, and keeps W1's as the default", () => {
    const { rerender } = render(<FileDropzone label="Add photos" media={[]} requiredCount={3} />);
    expect(screen.getByText(/before you can accept/)).toBeTruthy();
    rerender(
      <FileDropzone
        label="Add photos"
        media={[{ id: 'a' }]}
        requiredCount={3}
        locked={{
          title: 'Photos needed',
          message: (have, missing) => `${String(have)} added, ${String(missing)} to go`,
        }}
      />,
    );
    expect(screen.getByText('Photos needed')).toBeTruthy();
    expect(screen.getByText('1 added, 2 to go')).toBeTruthy();
    expect(screen.queryByText(/before you can accept/)).toBeNull();
  });
});

describe('the notice banners', () => {
  it('speak in four voices, and only the risk one interrupts', () => {
    render(
      <>
        <NoteBanner>How it works</NoteBanner>
        <WarnBanner title="Careful">Something is missing</WarnBanner>
        <RiskBanner>It failed</RiskBanner>
        <ReadyBanner title="Recorded">Done</ReadyBanner>
      </>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.getByRole('alert').textContent).toBe('It failed');
  });

  it('draws the alert mark on a warning, as the reference does, and not a lock', () => {
    const { container } = render(<WarnBanner>Check this</WarnBanner>);
    expect(container.querySelector('svg path')?.getAttribute('d')).toBe('M12 8v5M12 16h.01');
  });
});

describe('LoadingScreen and LoadFailed', () => {
  it('names what is loading and is busy', () => {
    render(<LoadingScreen label="Loading the trade" />);
    expect(screen.getByRole('status', { name: 'Loading the trade' }).getAttribute('aria-busy')).toBe('true');
  });

  it('offers a retry only when one can help', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<LoadFailed title="Couldn't load" body="Try later" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<LoadFailed title="Couldn't load" body="Gone" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps its content in the reference column', () => {
    const { container } = render(<ScreenColumn>x</ScreenColumn>);
    expect(container.firstElementChild?.className).toContain('max-w-[480px]');
  });
});

describe('TabNav', () => {
  const items = [
    { id: 'overview', label: 'Overview', href: '/trade/1' },
    { id: 'terms', label: 'Terms', href: '/trade/1/terms' },
    { id: 'activity', label: 'Activity', href: '/trade/1/activity' },
  ];

  it('links each view, marks only the current one, and is one named navigation', () => {
    render(<TabNav aria-label="Trade views" items={items} current="terms" />);
    const nav = screen.getByRole('navigation', { name: 'Trade views' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/trade/1',
      '/trade/1/terms',
      '/trade/1/activity',
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('marks nothing when the current id is not one of the tabs', () => {
    render(<TabNav aria-label="Trade views" items={items} current="elsewhere" />);
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });
});

describe('InfoCard', () => {
  it('lists plain facts and links, and only a link is focusable', () => {
    render(
      <InfoCard aria-label="Trade details">
        <InfoRow title="Waybill" detail="KT-883192" />
        <InfoRow title="Agreement" detail="Accepted terms" href="/trade/1/terms" />
      </InfoCard>,
    );
    const rows = within(screen.getByRole('list', { name: 'Trade details' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).queryByRole('link')).toBeNull();
    expect(
      within(rows[1]!)
        .getByRole('link', { name: /Agreement/ })
        .getAttribute('href'),
    ).toBe('/trade/1/terms');
  });
});

describe('CountdownStrip', () => {
  it('prints exactly the line it was given', () => {
    render(<CountdownStrip>Inspection ends · 2 Oct, 13:24</CountdownStrip>);
    expect(screen.getByText('Inspection ends · 2 Oct, 13:24')).toBeTruthy();
  });
});
