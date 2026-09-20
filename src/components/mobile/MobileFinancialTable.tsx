import type { ReactNode } from 'react';

export interface MobileFinancialColumn {
  key: string;
  label: string;
  /** Width in rem at Small text size; scales with the existing text preference. */
  width: number;
  className?: string;
}

/** One native scroll owner keeps header/body aligned without scroll synchronization.
 * The first column is always the sole frozen identity column. Surfaces own cells/data.
 */
export default function MobileFinancialTable({ label, columns, children, busy = false }: {
  label: string;
  columns: MobileFinancialColumn[];
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="mobile-financial-table-scroll" role="region" aria-label={`${label}, scroll for more columns and rows`} tabIndex={0}>
      <table className="mobile-financial-table" aria-label={label} aria-busy={busy}
        style={{ width: `calc(${columns.reduce((total, column) => total + column.width, 0)}rem * var(--ui-text-scale))` }}>
        <colgroup>{columns.map(column => <col key={column.key} style={{ width: `calc(${column.width}rem * var(--ui-text-scale))` }} />)}</colgroup>
        <thead><tr>{columns.map((column, index) => <th key={column.key} scope="col" className={[index === 0 ? 'mobile-financial-table-identity' : '', column.className ?? ''].filter(Boolean).join(' ')}>{column.label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function MobileFinancialTableDivider({ columns, children }: { columns: number; children: ReactNode }) {
  return <tr className="mobile-financial-table-divider"><td colSpan={columns}><span>{children}</span></td></tr>;
}
