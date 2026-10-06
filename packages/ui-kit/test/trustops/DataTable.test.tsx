// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, DataTable, type DataColumn, type DataTableProps } from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

interface Proposal {
  code: string;
  buyer: string;
  seller: string;
  amount: string;
  status: string;
}

/** N1's own rows (reference line 3540). */
const ROWS: Proposal[] = [
  {
    code: 'KMT-90142',
    buyer: 'Amaka B.',
    seller: 'Zaza Fashion',
    amount: '₦89,500',
    status: 'Awaiting Review',
  },
  {
    code: 'KMT-90138',
    buyer: 'Unverified number',
    seller: 'Prime Gadgets',
    amount: '₦1,450,000',
    status: 'High Risk',
  },
];

const COLUMNS: DataColumn<Proposal>[] = [
  { key: 'code', header: 'Trade Code', variant: 'mono', render: (row) => row.code },
  { key: 'buyer', header: 'Proposed by', render: (row) => row.buyer },
  { key: 'seller', header: 'To seller', render: (row) => row.seller },
  { key: 'amount', header: 'Amount', variant: 'amount', align: 'right', render: (row) => row.amount },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Chip tone={row.status === 'High Risk' ? 'risk' : 'awaiting'}>{row.status}</Chip>,
  },
];

const table = (rows: Proposal[] = ROWS, extra: Partial<DataTableProps<Proposal>> = {}) =>
  render(
    <main>
      <DataTable
        caption="Trade Proposals"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.code}
        {...extra}
      />
    </main>,
  );

describe('DataTable', () => {
  it('has an accessible name, taken from the caption the reference draws as a heading', () => {
    table();
    expect(screen.getByRole('table', { name: 'Trade Proposals' })).toBeDefined();
  });

  it('hides the caption by default and shows it when asked', () => {
    const hidden = table();
    expect(hidden.container.querySelector('caption')?.className).toBe('sr-only');
    hidden.unmount();
    const visible = table(ROWS, { captionVisible: true });
    expect(visible.container.querySelector('caption')?.className).not.toContain('sr-only');
  });

  it('scopes every column header, so a cell is announced with its column', () => {
    table();
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(5);
    for (const header of headers) expect(header.getAttribute('scope')).toBe('col');
    expect(headers.map((header) => header.textContent)).toEqual([
      'Trade Code',
      'Proposed by',
      'To seller',
      'Amount',
      'Status',
    ]);
  });

  it('renders one row per entry, with the cells the columns ask for', () => {
    table();
    // One header row plus two body rows.
    expect(screen.getAllByRole('row')).toHaveLength(3);
    const risky = screen.getByRole('row', { name: /KMT-90138/ });
    expect(within(risky).getByText('High Risk')).toBeDefined();
  });

  it('sets codes in mono and amounts in mono semibold, as the reference does', () => {
    const { container } = table();
    const cells = container.querySelectorAll('tbody tr:first-child td');
    expect(cells[0]?.className).toContain('font-mono');
    expect(cells[3]?.className).toContain('font-mono');
    expect(cells[3]?.className).toContain('font-semibold');
    expect(cells[3]?.className).toContain('text-right');
    expect(cells[1]?.className).not.toContain('font-mono');
  });

  it('draws the reference’s table foot when one is given', () => {
    table(ROWS, { footer: <span>3 of 6 flagged proposals</span> });
    expect(screen.getByText('3 of 6 flagged proposals')).toBeDefined();
  });

  it('keeps the table structure when there is nothing to show', () => {
    table([], { empty: 'No proposals are flagged right now.' });
    expect(screen.getByRole('table', { name: 'Trade Proposals' })).toBeDefined();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    const cell = screen.getByRole('cell');
    expect(cell.textContent).toBe('No proposals are flagged right now.');
    expect(cell.getAttribute('colspan')).toBe('5');
  });

  it('lets a caller ask for a blank empty cell', () => {
    table([], { empty: null });
    expect(screen.getByRole('cell').textContent).toBe('');
  });

  it('never emits colspan="0", which is specified and implemented by nobody', () => {
    render(
      <main>
        <DataTable caption="Nothing at all" columns={[]} rows={[]} rowKey={(row: Proposal) => row.code} />
      </main>,
    );
    expect(screen.getByRole('cell').getAttribute('colspan')).toBe('1');
  });

  it('offers no sort affordance — the reference draws none, and a dead one is worse than none', () => {
    table();
    expect(screen.queryByRole('button')).toBeNull();
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.getAttribute('aria-sort')).toBeNull();
    }
  });

  it('passes axe, with rows and empty', async () => {
    const filled = table();
    await expectNoAxeViolations(filled.container);
    filled.unmount();
    const blank = table([]);
    await expectNoAxeViolations(blank.container);
  });
});
