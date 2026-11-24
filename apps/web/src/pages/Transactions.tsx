import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TRANSFER_STATUSES, STATUS_LABELS } from '@ebk/core';
import { ButtonLink, Card, EmptyState, ErrorState, IconList, MoneyText, PageHeader, Skeleton, Table, cx } from '../design-system';
import { api } from '../lib/auth';
import { formatDateTime, initials } from '../lib/format';
import type { TransferDto } from '../lib/types';
import { StatusBadge } from './Home';

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PAYOUT_PROCESSING', label: 'In progress' },
  { value: 'PENDING_PAYMENT', label: 'Awaiting payment' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
];

export function TransactionsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['transfers', 'list', status], queryFn: () => api.transfers.list({ status: status || undefined, limit: 50 }) });

  return (
    <>
      <PageHeader title="Transactions" subtitle="Track your transfers and download receipts" action={<ButtonLink to="/send">Send money</ButtonLink>} />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={status === f.value}
            onClick={() => setStatus(f.value)}
            className={cx('h-9 shrink-0 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors', status === f.value ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-ink ring-line-strong hover:ring-emerald-600')}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Card padded={false} className="p-5 sm:p-2">
        {q.isLoading ? (
          <div className="space-y-3 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (q.data?.items ?? []).length === 0 ? (
          <EmptyState icon={<IconList />} title={status ? `No ${STATUS_LABELS[status as (typeof TRANSFER_STATUSES)[number]]?.label.toLowerCase() ?? ''} transfers` : 'No transfers yet'} body="Transfers you make will appear here with their live status." action={!status && <ButtonLink to="/send">Send money</ButtonLink>} />
        ) : (
          <Table<TransferDto>
            caption="Your transfers"
            rows={q.data!.items}
            rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`/transfers/${t.id}`)}
            columns={[
              {
                key: 'recipient',
                header: 'Recipient',
                cell: (t) => (
                  <span className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-mint-100 text-emerald-700 text-xs font-bold">{initials(t.recipient.fullName)}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink truncate">{t.recipient.fullName}</span>
                      <span className="block text-xs text-muted-strong sm:hidden">{formatDateTime(t.createdAt)}</span>
                      <span className="hidden sm:block text-xs text-muted-strong font-mono">{t.reference}</span>
                    </span>
                  </span>
                ),
              },
              { key: 'date', header: 'Date', hideOnMobile: true, cell: (t) => <span className="text-muted-strong">{formatDateTime(t.createdAt)}</span> },
              { key: 'status', header: 'Status', hideOnMobile: true, cell: (t) => <StatusBadge t={t} /> },
              { key: 'received', header: 'They get', hideOnMobile: true, align: 'right', cell: (t) => <MoneyText value={t.recipientAmount} className="text-muted-strong" /> },
              {
                key: 'sent',
                header: 'You sent',
                align: 'right',
                cell: (t) => (
                  <span>
                    <MoneyText value={t.totalPayable} className="block font-semibold text-ink" />
                    <span className="sm:hidden mt-1 inline-block"><StatusBadge t={t} /></span>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
