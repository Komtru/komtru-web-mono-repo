// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ADVISORY_LABEL, Button, DecisionPanel, HUMAN_DECIDES } from '../../src/index.js';
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

  it('refuses to render with no action', () => {
    expect(() => render(<DecisionPanel actions={null} policy={POLICY} />)).toThrow(/no actions/);
    expect(() => render(<DecisionPanel actions={[]} policy={POLICY} />)).toThrow(/no actions/);
  });

  it('takes the heading level from the page it is dropped into', () => {
    const { container } = panel({ headingLevel: 3, heading: 'TrustOps decision' });
    expect(container.querySelector('h3')?.textContent).toBe('TrustOps decision');
    expect(screen.getByRole('region', { name: 'TrustOps decision' })).toBeDefined();
  });

  it('derives stable ids from the policy, so it needs no hook and no client boundary', () => {
    panel();
    expect(actionGroup().getAttribute('aria-describedby')).toBe(
      'komtru-decision-new-buyer-proposal-policy-2-1-divider ' +
        'komtru-decision-new-buyer-proposal-policy-2-1-policy',
    );
  });

  it('lets two panels on one page be told apart with idPrefix', () => {
    render(
      <main>
        <DecisionPanel advisory={ADVICE} actions={ACTIONS} policy={POLICY} idPrefix="left" />
        <DecisionPanel
          advisory={ADVICE}
          actions={<Button>Approve</Button>}
          policy={POLICY}
          idPrefix="right"
          heading="Second decision"
          actionsLabel="Second decision actions"
          advisoryLabel="Second advisory — not a decision"
        />
      </main>,
    );
    expect(screen.getByRole('group', { name: 'Decision actions' }).getAttribute('aria-describedby')).toBe(
      'left-divider left-policy',
    );
    expect(
      screen.getByRole('group', { name: 'Second decision actions' }).getAttribute('aria-describedby'),
    ).toBe('right-divider right-policy');
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
