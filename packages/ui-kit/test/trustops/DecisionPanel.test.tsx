// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ADVISORY_LABEL, AdvisoryBox, Button, DecisionPanel, HUMAN_DECIDES } from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

const ADVICE =
  'Unverified number plus first-Trade amount 34x the median matches the pattern behind 70% of ' +
  'proposals later confirmed as social-engineering attempts. Suggest: require phone verification ' +
  'before this reaches the seller.';

const POLICY = {
  policy: 'New-Buyer Proposal Policy',
  section: '2.1',
  note: 'same threshold, every case',
} as const;

const ACTIONS = (
  <>
    <Button>Require verification before forwarding</Button>
    <Button variant="secondary">Forward to seller anyway</Button>
    <Button variant="secondary">Block this proposal</Button>
  </>
);

/** N2 (reference line 3581), the screen this panel is traced from. */
function panel(overrides: Partial<React.ComponentProps<typeof DecisionPanel>> = {}) {
  return render(
    <main>
      <DecisionPanel advisory={ADVICE} actions={ACTIONS} policy={POLICY} {...overrides} />
    </main>,
  );
}

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[role="button"],[role="link"]';

const advisoryRegion = () => screen.getByRole('region', { name: ADVISORY_LABEL });
const actionGroup = () => screen.getByRole('group', { name: 'Decision actions' });

describe('DecisionPanel — the advisory is separate from the actions', () => {
  it('puts the advisory in its own landmark, not in the panel’s', () => {
    panel();
    expect(screen.getByRole('region', { name: 'Decision' })).toBeDefined();
    expect(advisoryRegion()).toBeDefined();
    expect(advisoryRegion()).not.toBe(screen.getByRole('region', { name: 'Decision' }));
  });

  it('never puts the advisory inside the button group, in either direction', () => {
    panel();
    expect(actionGroup().contains(advisoryRegion())).toBe(false);
    expect(advisoryRegion().contains(actionGroup())).toBe(false);
  });

  it('puts every action inside the group and nothing focusable inside the advisory', () => {
    panel();
    expect(within(actionGroup()).getAllByRole('button')).toHaveLength(3);
    expect(advisoryRegion().querySelectorAll(FOCUSABLE)).toHaveLength(0);
    // Every button on the panel is one of the group's — none escaped to the advisory or the footer.
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  /**
   * DOM containment is not the accessibility tree. `aria-owns` reparents a node for every screen
   * reader without moving it one byte in the DOM, so a single attribute on the action group would
   * put the advisory inside the group while every `contains()` assertion above kept passing. This
   * is the test that notices.
   */
  it('reparents nothing into the action group — no aria-owns, anywhere on the panel', () => {
    const { container } = panel();
    expect(actionGroup().getAttribute('aria-owns')).toBeNull();
    expect(container.querySelectorAll('[aria-owns]')).toHaveLength(0);
  });

  it('never names or describes the group with the advisory', () => {
    panel();
    const advisoryId = advisoryRegion().getAttribute('id');
    const group = actionGroup();
    for (const attribute of ['aria-owns', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
      const value = group.getAttribute(attribute) ?? '';
      const referenced = value.split(' ').filter((id) => id !== '');
      // Whatever the group points at, none of it may be the advisory or live inside it.
      for (const id of referenced) {
        const target = document.getElementById(id);
        expect(target === null || !advisoryRegion().contains(target)).toBe(true);
        if (advisoryId !== null) expect(id).not.toBe(advisoryId);
      }
    }
  });

  it('leaves the advisory outside every grouping role on the panel', () => {
    panel();
    expect(advisoryRegion().closest('[role="group"],[role="toolbar"],[role="radiogroup"]')).toBeNull();
  });

  it('keeps the group’s announced content to the actions themselves', () => {
    panel();
    // If the advisory ever moved inside the group, a screen reader entering the group would read
    // the suggestion as part of the controls. The group's whole text is the three button labels.
    expect(actionGroup().textContent).toBe(
      'Require verification before forwardingForward to seller anywayBlock this proposal',
    );
    expect(actionGroup().textContent).not.toContain('AI-suggested');
    expect(actionGroup().textContent).not.toContain('Suggest:');
  });

  it('reads advisory, then divider, then actions, then policy — in that order', () => {
    panel();
    const order = [
      advisoryRegion(),
      screen.getByText(HUMAN_DECIDES),
      actionGroup(),
      screen.getByText(/^Applied per/),
    ];
    for (let i = 0; i < order.length - 1; i += 1) {
      const current = order[i];
      const next = order[i + 1];
      if (current === undefined || next === undefined) throw new Error('missing node');
      // DOCUMENT_POSITION_FOLLOWING === 4: `next` comes after `current` in document order.
      expect(current.compareDocumentPosition(next) & 4).toBe(4);
    }
  });

  it('describes the action group with the divider and the citation', () => {
    panel();
    const ids = (actionGroup().getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    const described = ids.map((id) => document.getElementById(id)?.textContent);
    expect(described[0]).toBe(HUMAN_DECIDES);
    expect(described[1]).toBe('Applied per New-Buyer Proposal Policy §2.1 — same threshold, every case');
  });

  it('prints the divider the reference prints, word for word', () => {
    panel();
    expect(HUMAN_DECIDES).toBe('a human decides, always');
    expect(screen.getByText(HUMAN_DECIDES)).toBeDefined();
  });
});

describe('DecisionPanel', () => {
  it('drops the divider when there is no advice to separate, and keeps the citation', () => {
    panel({ advisory: undefined });
    expect(screen.queryByRole('region', { name: ADVISORY_LABEL })).toBeNull();
    expect(screen.queryByText(HUMAN_DECIDES)).toBeNull();
    const ids = (actionGroup().getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0] ?? '')?.textContent).toMatch(/^Applied per/);
  });

  // `Children.count` counts `false` and `null` as children, so the idiomatic conditional render
  // used to sail past the guard and produce an empty group under an AI suggestion.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty array', []],
    ['a false branch — actions={canApprove && <Button/>}', false],
    ['an array of nothing', [null, null]],
  ])('refuses to render when the actions are %s', (_label, actions) => {
    expect(() => render(<DecisionPanel actions={actions} policy={POLICY} />)).toThrow(/no actions/);
  });

  it('renders when that same conditional branch is taken', () => {
    const canApprove = true;
    panel({ actions: canApprove && <Button>Approve</Button> });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
  });

  it('refuses an AdvisoryBox smuggled in among the actions', () => {
    expect(() =>
      panel({
        actions: (
          <>
            <AdvisoryBox label="Smuggled advice — not a decision">Approve this one.</AdvisoryBox>
            <Button>Approve</Button>
          </>
        ),
      }),
    ).toThrow(/among its actions/);
  });

  it.each([
    ['heading', { heading: '  ' }],
    ['actionsLabel', { actionsLabel: '' }],
    ['divider', { divider: '' }],
  ])('refuses a blank %s, because a blank one silently removes what it names', (_prop, overrides) => {
    expect(() => panel(overrides)).toThrow(/cannot be blank/);
  });

  it('refuses a blank advisory label, which would delete the advisory landmark', () => {
    expect(() => panel({ advisoryLabel: '' })).toThrow(/cannot be unnamed/);
  });

  it('takes the heading level from the page it is dropped into', () => {
    const { container } = panel({ headingLevel: 3, heading: 'TrustOps decision' });
    expect(container.querySelector('h3')?.textContent).toBe('TrustOps decision');
    expect(screen.getByRole('region', { name: 'TrustOps decision' })).toBeDefined();
  });

  /**
   * The queue case: several flagged proposals on one screen, all under the same clause. An earlier
   * version derived the ids from the citation to stay a server component, so both panels emitted
   * the same ids and the second described itself with the first one's divider and cite.
   */
  it('gives two panels citing the same policy their own ids and their own description', () => {
    render(
      <main>
        <DecisionPanel
          advisory={ADVICE}
          actions={<Button>Approve first</Button>}
          policy={POLICY}
          heading="First decision"
          actionsLabel="First decision actions"
          advisoryLabel="First advisory — not a decision"
          divider="a human decides, always (one)"
        />
        <DecisionPanel
          advisory={ADVICE}
          actions={<Button>Approve second</Button>}
          policy={POLICY}
          heading="Second decision"
          actionsLabel="Second decision actions"
          advisoryLabel="Second advisory — not a decision"
          divider="a human decides, always (two)"
        />
      </main>,
    );
    const describedBy = (name: string) =>
      (screen.getByRole('group', { name }).getAttribute('aria-describedby') ?? '').split(' ');
    const first = describedBy('First decision actions');
    const second = describedBy('Second decision actions');
    expect(new Set([...first, ...second]).size).toBe(4);
    expect(document.getElementById(first[0] ?? '')?.textContent).toBe('a human decides, always (one)');
    expect(document.getElementById(second[0] ?? '')?.textContent).toBe('a human decides, always (two)');
    // Every id on the page is still unique, which is what `duplicate-id-aria` would have reported.
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('still lets a caller fix the ids', () => {
    panel({ idPrefix: 'left' });
    expect(actionGroup().getAttribute('aria-describedby')).toBe('left-divider left-policy');
  });

  it('draws the reference’s footnote outside the card, where the reference draws it', () => {
    panel({ footnote: 'This never implies the buyer is dishonest.' });
    const footnote = screen.getByText('This never implies the buyer is dishonest.');
    expect(screen.getByRole('region', { name: 'Decision' }).contains(footnote)).toBe(false);
  });

  it('passes axe, with and without the advisory', async () => {
    const withAdvisory = panel();
    await expectNoAxeViolations(withAdvisory.container);
    withAdvisory.unmount();
    const without = panel({ advisory: undefined });
    await expectNoAxeViolations(without.container);
  });

  it('passes the landmark rules in particular — the two regions are distinct and separately named', async () => {
    const { container } = panel();
    await expectNoAxeViolations(container, {
      runOnly: [
        'landmark-unique',
        'landmark-complementary-is-top-level',
        'region',
        'aria-allowed-role',
        'aria-valid-attr-value',
      ],
    });
  });
});
