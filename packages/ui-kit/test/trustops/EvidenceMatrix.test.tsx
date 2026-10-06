// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EvidenceMatrix, type EvidenceRow } from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

/** TO-PA2's own four rows (reference line 8862). */
const ROWS: EvidenceRow[] = [
  { id: 'identity', label: 'Identity', detail: 'National ID · name match · verified', state: 'pass' },
  {
    id: 'authority',
    label: 'Park authority',
    detail: 'Counter photo · signage match · staff authority not yet proven',
    state: 'gap',
  },
  { id: 'hub', label: 'Hub details', detail: 'Address, terminal, phone supplied', state: 'pass' },
  { id: 'payout', label: 'Payout', detail: 'GTBank •••• 5567 · account-name match required', state: 'check' },
];

const matrix = (rows: EvidenceRow[] = ROWS) =>
  render(
    <main>
      <EvidenceMatrix rows={rows} />
    </main>,
  );

describe('EvidenceMatrix', () => {
  it('is a countable list, one item per requirement', () => {
    matrix();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
  });

  it('names the three states in words, not only in colour', () => {
    matrix();
    expect(screen.getAllByText('Pass')).toHaveLength(2);
    expect(screen.getByText('Gap')).toBeDefined();
    expect(screen.getByText('Check')).toBeDefined();
  });

  it('maps pass, gap and check onto the reference’s ready, hold and review pairs', () => {
    matrix();
    expect(screen.getAllByText('Pass')[0]?.className).toContain('bg-success-soft');
    expect(screen.getAllByText('Pass')[0]?.className).toContain('text-success-on-soft');
    expect(screen.getByText('Gap').className).toContain('bg-warning-soft');
    expect(screen.getByText('Gap').className).toContain('text-warning-on-soft');
    expect(screen.getByText('Check').className).toContain('bg-info-soft');
    expect(screen.getByText('Check').className).toContain('text-info-on-soft');
  });

  it('reads label, then detail, then state, for every row', () => {
    matrix();
    const authority = screen.getAllByRole('listitem')[1];
    expect(authority?.textContent).toBe(
      'Park authorityCounter photo · signage match · staff authority not yet provenGap',
    );
  });

  it('is a named landmark so a reviewer can jump straight to the evidence', () => {
    matrix();
    expect(screen.getByRole('region', { name: 'Evidence matrix' })).toBeDefined();
  });

  it('takes a custom heading and level', () => {
    render(
      <main>
        <EvidenceMatrix rows={ROWS} heading="What we know" headingLevel={3} />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'What we know' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'What we know' })).toBeDefined();
  });

  it('hides the row icons from the accessibility tree — they illustrate the label, not add to it', () => {
    const { container } = matrix();
    expect(container.querySelectorAll('li > span[aria-hidden="true"]')).toHaveLength(4);
    expect(container.querySelectorAll('li svg[aria-hidden="true"]')).toHaveLength(4);
  });

  /** Same argument as `Timeline`: these rows are server data, so zero of them degrades. */
  it('says so when no evidence has been recorded', () => {
    render(
      <main>
        <EvidenceMatrix rows={[]} />
      </main>,
    );
    expect(screen.getByRole('region', { name: 'Evidence matrix' })).toBeDefined();
    expect(screen.getByText('No evidence has been recorded on this case yet.')).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('takes a case-specific empty state', () => {
    render(<EvidenceMatrix rows={[]} empty="Waiting on the applicant’s first upload." />);
    expect(screen.getByText('Waiting on the applicant’s first upload.')).toBeDefined();
  });

  it('passes axe, with rows and without', async () => {
    const filled = matrix();
    await expectNoAxeViolations(filled.container);
    filled.unmount();
    const blank = matrix([]);
    await expectNoAxeViolations(blank.container);
  });
});
