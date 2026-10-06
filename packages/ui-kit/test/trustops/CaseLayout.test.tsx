// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ADVISORY_LABEL,
  Button,
  CaseLayout,
  Chip,
  DecisionPanel,
  EvidenceMatrix,
  Timeline,
} from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

/** N2 (reference line 3581), assembled out of the patterns this ticket ships. */
function n2() {
  return render(
    <main>
      <CaseLayout
        caseId="KMT-90138 · Proposed 8 minutes ago"
        subject="Unusually large first-time proposal"
        parties="Unverified number (buyer) → Prime Gadgets (seller) · ₦1,450,000"
        status={<Chip tone="risk">High Risk</Chip>}
        ownerActions={<Button variant="secondary">Reassign</Button>}
        evidence={
          <Timeline
            heading="What we know"
            headingLevel={3}
            events={[
              { id: '1', title: 'Phone number not yet verified', detail: 'Signed up 4 minutes before.' },
              { id: '2', title: 'Amount well outside typical first Trades', detail: 'Median: ₦42,000.' },
            ]}
          />
        }
        decision={
          <DecisionPanel
            headingLevel={3}
            advisory="Suggest: require phone verification before this reaches the seller."
            actions={
              <>
                <Button>Require verification before forwarding</Button>
                <Button variant="secondary">Block this proposal</Button>
              </>
            }
            policy={{ policy: 'New-Buyer Proposal Policy', section: '2.1' }}
          />
        }
      />
    </main>,
  );
}

/** The header is the first child of the case's own section. */
function caseHeader(subject = 'Unusually large first-time proposal'): HTMLElement {
  const header = screen.getByRole('region', { name: subject }).firstElementChild;
  if (!(header instanceof HTMLElement)) throw new Error('no case header');
  return header;
}

describe('CaseLayout', () => {
  it('names the case by its subject and sets the id in mono', () => {
    n2();
    const id = screen.getByText('KMT-90138 · Proposed 8 minutes ago');
    expect(id.className).toContain('font-mono');
    expect(caseHeader().contains(id)).toBe(true);
  });

  it('does not turn the case header into a banner landmark', () => {
    n2();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(caseHeader().tagName).toBe('DIV');
  });

  it('carries the risk chip and the owner actions in the header', () => {
    n2();
    expect(caseHeader().contains(screen.getByText('High Risk'))).toBe(true);
    expect(caseHeader().contains(screen.getByRole('button', { name: 'Reassign' }))).toBe(true);
  });

  it('puts evidence before the decision in the DOM, so it stacks that way on a narrow screen', () => {
    n2();
    const evidence = screen.getByRole('region', { name: 'What we know' });
    const decision = screen.getByRole('region', { name: 'Decision' });
    expect(evidence.compareDocumentPosition(decision) & 4).toBe(4);
  });

  it('keeps the advisory separate even nested three regions deep', () => {
    n2();
    const advisory = screen.getByRole('region', { name: ADVISORY_LABEL });
    const actions = screen.getByRole('group', { name: 'Decision actions' });
    expect(actions.contains(advisory)).toBe(false);
    expect(screen.getByRole('region', { name: 'Decision' }).contains(advisory)).toBe(true);
  });

  it('collapses to one column below md', () => {
    const { container } = n2();
    const grid = container.querySelector('section > div + div');
    expect(grid?.className).toContain('grid-cols-1');
    expect(grid?.className).toContain('md:grid-cols-[1.3fr_1fr]');
  });

  it('renders without a status or owner actions', () => {
    const { container } = render(
      <CaseLayout
        caseId="PH-10482"
        subject="Jibowu Park Hub"
        evidence={
          <EvidenceMatrix rows={[{ id: 'a', label: 'Identity', detail: 'Verified', state: 'pass' }]} />
        }
        decision={<p>Pending</p>}
      />,
    );
    expect(container.querySelector('section > div:first-child > div + div')).toBeNull();
  });

  it('passes axe — four nested landmarks, all distinctly named', async () => {
    const { container } = n2();
    await expectNoAxeViolations(container);
  });
});
