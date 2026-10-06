import { cx } from '../primitives/cx.js';

/** `td.mono` is a code, `td.amt` is money — both set in the mono face, money also semibold. */
export type DataCellVariant = 'default' | 'mono' | 'amount';

export interface DataColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => React.ReactNode;
  align?: 'left' | 'right';
  variant?: DataCellVariant;
}

export interface DataTableProps<Row> {
  /**
   * Required. A table with no accessible name is a grid of numbers a screen-reader user has to
   * reconstruct from the column headers; the reference always has a heading above the table, and
   * this is that heading, said to the accessibility tree.
   */
  caption: string;
  /** The reference draws the caption as a heading above the frame, so it is hidden by default. */
  captionVisible?: boolean;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** `.table-foot` — "3 of 6 flagged proposals". */
  footer?: React.ReactNode;
  /** Shown in place of the rows when there are none. */
  empty?: React.ReactNode;
  className?: string;
}

const VARIANTS: Record<DataCellVariant, string> = {
  default: '',
  mono: 'font-mono text-[12px]',
  amount: 'font-mono font-semibold',
};

/**
 * `table.data-table` inside `.table-wrap` — the TrustOps queue table (N1, TO-PA7).
 *
 * A real `<table>` with `<th scope="col">`, not a grid of divs: the console's tables are the one
 * place in the product where a reader navigates by cell and needs the column announced with the
 * value. No sorting affordance — the reference draws none and the ticket asks for none, and a
 * header that looks sortable but is not is worse than a header that does not.
 */
export function DataTable<Row>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  footer,
  empty,
  className,
}: DataTableProps<Row>): React.JSX.Element {
  return (
    <div
      className={cx(
        'overflow-x-auto rounded-lg border border-solid border-border-hairline bg-surface-elevated',
        className,
      )}
    >
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <caption className={captionVisible ? 'p-[14px] text-left text-[14px] font-semibold' : 'sr-only'}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  'sticky top-0 whitespace-nowrap border-b border-solid border-b-border-hairline bg-surface-secondary py-[12px] px-[14px] text-left text-[11px] uppercase tracking-[.05em] text-slate',
                  column.align === 'right' && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                // `colspan="0"` is spec'd to span the colgroup and implemented by nobody.
                colSpan={Math.max(1, columns.length)}
                className="py-[12px] px-[14px] text-center align-middle text-slate"
              >
                {empty === undefined ? 'Nothing to show.' : empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="group hover:bg-surface-secondary">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'border-b border-solid border-b-border-hairline py-[12px] px-[14px] align-middle group-last:border-b-0',
                      column.align === 'right' && 'text-right',
                      VARIANTS[column.variant ?? 'default'],
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {footer !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-[10px] py-[12px] px-[14px] text-[12px] text-slate">
          {footer}
        </div>
      )}
    </div>
  );
}
