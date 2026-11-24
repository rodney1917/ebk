import type { ReactNode } from 'react';
import type { Money, RateKind } from '../lib/types';
import { formatMoneyDto } from '../lib/format';
import { Badge, cx } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  hideOnMobile?: boolean;
}

/** Responsive table: real <table> from sm upwards, stacked rows on phones. */
export function Table<T>({ columns, rows, rowKey, onRowClick, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; caption: string }) {
  return (
    <div className="overflow-x-auto -mx-5 sm:mx-0">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden sm:table-header-group">
          <tr className="text-left text-xs uppercase tracking-wide text-muted-strong">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-4 py-2.5 font-semibold', c.align === 'right' && 'text-right')}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx('border-t border-line', onRowClick && 'cursor-pointer hover:bg-mint-50/60 focus-visible:bg-mint-50')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-5 sm:px-4 py-3.5', c.align === 'right' && 'text-right', c.hideOnMobile && 'hidden sm:table-cell')}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: ReactNode; value: ReactNode; emphasis?: boolean }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-6 py-3">
          <dt className="text-sm text-muted-strong">{it.label}</dt>
          <dd className={cx('text-right ebk-amount', it.emphasis ? 'text-base font-bold text-ink' : 'text-sm font-semibold text-ink')}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MoneyText({ value, className }: { value: Money; className?: string }) {
  return <span className={cx('ebk-amount', className)}>{formatMoneyDto(value)}</span>;
}

/**
 * Every rate shown in EBK says where it came from. LIVE is the only kind
 * that may be presented as live; SANDBOX is always flagged as test data.
 */
export function RateKindBadge({ kind }: { kind: RateKind }) {
  if (kind === 'LIVE') return <Badge tone="success" dot>Live rate</Badge>;
  if (kind === 'SANDBOX') return <Badge tone="warning">Sandbox rate · test only</Badge>;
  return <Badge tone="neutral">Estimated rate</Badge>;
}
