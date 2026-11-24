import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { isTerminal } from '@ebk/core';
import {
  Alert, Button, ButtonLink, Card, CardHeader, cx, DescriptionList, ErrorState, IconCheck, IconChevronLeft, IconDownload, LogoMark,
  MoneyText, PageHeader, PageLoader, RateKindBadge, IconShare,
} from '../design-system';
import { api } from '../lib/auth';
import { formatDateTime, formatMoneyDto, formatRate } from '../lib/format';
import type { TransferDto, TransferStatus } from '../lib/types';
import { StatusBadge } from './Home';

/** Customer-facing journey. Statuses not on the happy path are shown when they occur. */
const JOURNEY: { status: TransferStatus; label: string }[] = [
  { status: 'DRAFT', label: 'Transfer created' },
  { status: 'PENDING_PAYMENT', label: 'Waiting for your payment' },
  { status: 'PAYMENT_RECEIVED', label: 'Payment received' },
  { status: 'PAYOUT_PROCESSING', label: 'Paying out to mobile money' },
  { status: 'COMPLETED', label: 'Delivered' },
];

function Timeline({ t }: { t: TransferDto }) {
  const reached = new Map(t.timeline.map((e) => [e.status, e.at]));
  const offPath = t.timeline.filter((e) => !JOURNEY.some((j) => j.status === e.status));
  const steps = isTerminal(t.status) && t.status !== 'COMPLETED' ? [...JOURNEY.filter((j) => reached.has(j.status)), ...offPath.map((e) => ({ status: e.status, label: e.label }))] : JOURNEY;
  return (
    <ol className="relative space-y-5">
      {steps.map((s, i) => {
        const at = reached.get(s.status) ?? offPath.find((o) => o.status === s.status)?.at;
        const done = !!at;
        const current = s.status === t.status;
        const bad = ['FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(s.status);
        return (
          <li key={s.status} className="relative flex gap-4">
            {i < steps.length - 1 && <span className={cx('absolute left-[13px] top-7 h-[calc(100%-4px)] w-0.5', done ? 'bg-emerald-600' : 'bg-line')} aria-hidden />}
            <span className={cx('relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-white', bad ? 'bg-danger-700 text-white' : done ? 'bg-emerald-600 text-white' : 'bg-line text-muted')}>
              {done && !bad ? <IconCheck size={14} /> : <span className="size-2 rounded-full bg-current" />}
            </span>
            <span className="pt-0.5">
              <span className={cx('block text-sm font-semibold', done ? 'text-ink' : 'text-muted-strong')}>
                {s.label}
                {current && !isTerminal(t.status) && <span className="ml-2 inline-block size-2 rounded-full bg-emerald-500 animate-pulse align-middle" aria-label="current step" />}
              </span>
              {at && <span className="block text-xs text-muted-strong">{formatDateTime(at)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TransactionDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['transfer', id],
    queryFn: () => api.transfers.get(id),
    refetchInterval: (query) => (query.state.data && isTerminal(query.state.data.status) ? false : 3000),
  });
  const cancel = useMutation({ mutationFn: () => api.transfers.cancel(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['transfer', id] }) });

  if (q.isLoading) return <PageLoader label="Loading transfer" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        back={<Link to="/transfers" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline"><IconChevronLeft size={16} /> Transactions</Link>}
        title={<>To {t.recipient.fullName}</>}
        subtitle={<span className="font-mono text-sm">{t.reference}</span>}
        action={<StatusBadge t={t} />}
      />
      {params.get('new') === '1' && !isTerminal(t.status) && (
        <Alert tone="success" title="Transfer submitted" className="mb-4">We’ll update this page as your money moves. You can leave and come back at any time.</Alert>
      )}
      {t.status === 'FAILED' && <Alert tone="danger" title="This transfer failed" className="mb-4">No money was taken, or any payment will be returned in full. Contact support quoting {t.reference} if you need help.</Alert>}
      {t.status === 'COMPLIANCE_REVIEW' && <Alert tone="info" title="Your transfer is being reviewed" className="mb-4">This is a routine check. We may contact you for more information.</Alert>}
      {t.payment?.checkoutUrl && t.status === 'PENDING_PAYMENT' && (
        <Alert tone="warning" title="Payment not completed" className="mb-4" action={<Button size="sm" onClick={() => window.location.assign(t.payment!.checkoutUrl!)}>Pay now</Button>}>Complete your payment to send this transfer.</Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Amounts" />
          <DescriptionList items={[
            { label: 'You sent', value: formatMoneyDto(t.sendAmount) },
            { label: 'EBK fee', value: formatMoneyDto(t.fee) },
            { label: 'Total paid', value: formatMoneyDto(t.totalPayable), emphasis: true },
            { label: 'Exchange rate', value: <span className="inline-flex flex-wrap justify-end items-center gap-2">{formatRate(t.exchangeRate.value, t.sendAmount.currency, t.recipientAmount.currency)} <RateKindBadge kind={t.exchangeRate.kind} /></span> },
            { label: 'Recipient gets', value: <MoneyText value={t.recipientAmount} className="text-emerald-700" />, emphasis: true },
          ]} />
          <div className="mt-4 border-t border-line pt-2">
            <DescriptionList items={[
              { label: 'Paid to', value: `${t.recipient.network ?? ''} · ${t.recipient.accountMasked ?? ''}` },
              { label: 'Created', value: formatDateTime(t.createdAt) },
              ...(t.completedAt ? [{ label: 'Delivered', value: formatDateTime(t.completedAt) }] : []),
            ]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Progress" />
          <Timeline t={t} />
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink to={`/transfers/${t.id}/receipt`} variant="navy" className="gap-2"><IconDownload size={18} /> Receipt</ButtonLink>
        {(t.status === 'DRAFT' || t.status === 'PENDING_PAYMENT') && (
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel transfer</Button>
        )}
      </div>
      {cancel.error && <Alert tone="danger" className="mt-3">{(cancel.error as Error).message}</Alert>}
    </div>
  );
}

export function ReceiptPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => api.transfers.receipt(id) });
  if (q.isLoading) return <PageLoader label="Preparing receipt" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;

  const share = async () => {
    const text = `EBK transfer ${r.reference}: ${formatMoneyDto(r.recipientAmount)} to ${r.recipient.fullName} — ${r.statusLabel}`;
    if (navigator.share) await navigator.share({ title: `EBK receipt ${r.reference}`, text }).catch(() => undefined);
    else await navigator.clipboard?.writeText(text);
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/transfers/${r.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline"><IconChevronLeft size={16} /> Back to transfer</Link>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<IconShare size={16} />} onClick={share}>Share</Button>
          <Button size="sm" icon={<IconDownload size={16} />} onClick={() => window.print()}>Download PDF</Button>
        </div>
      </div>
      <article className="bg-white rounded-[var(--radius-card)] border border-line shadow-[var(--shadow-card)] overflow-hidden print:shadow-none print:border-0" aria-label="Transfer receipt">
        <header className="bg-navy-900 text-white px-6 py-5 flex items-center justify-between ebk-grid-bg">
          <span className="flex items-center gap-3"><LogoMark size={40} /><span><span className="block font-extrabold text-lg leading-none">EBK</span><span className="block text-xs text-mint-300 mt-1">Empower. Bank. Connect.</span></span></span>
          <span className="text-right text-sm"><span className="block text-mint-300 text-xs uppercase tracking-wide">Receipt</span><span className="font-mono">{r.reference}</span></span>
        </header>
        {r.isSandbox && <p className="bg-warning-50 text-warning-700 text-xs font-semibold text-center py-1.5">SANDBOX / TEST TRANSACTION — NOT A REAL PAYMENT</p>}
        <div className="px-6 py-6">
          <p className="text-sm text-muted-strong">Amount received</p>
          <p className="text-[32px] font-bold text-emerald-700 ebk-amount">{formatMoneyDto(r.recipientAmount)}</p>
          <p className="mt-1"><StatusBadge t={r} /></p>
          <div className="mt-5">
            <DescriptionList items={[
              { label: 'Sender', value: r.sender.name },
              { label: 'Recipient', value: r.recipient.fullName },
              { label: 'Payout method', value: `${r.payoutMethodName ?? 'Mobile money'} · ${r.recipient.accountMasked ?? ''}` },
              { label: 'Payment method', value: r.paymentMethod ?? '—' },
              { label: 'Amount sent', value: formatMoneyDto(r.sendAmount) },
              { label: 'Fee', value: formatMoneyDto(r.fee) },
              { label: 'Total paid', value: formatMoneyDto(r.totalPayable), emphasis: true },
              { label: 'Exchange rate', value: formatRate(r.exchangeRate.value, r.sendAmount.currency, r.recipientAmount.currency) },
              { label: 'Date', value: formatDateTime(r.createdAt) },
              ...(r.completedAt ? [{ label: 'Delivered', value: formatDateTime(r.completedAt) }] : []),
            ]} />
          </div>
        </div>
        <footer className="border-t border-line bg-canvas px-6 py-4 text-xs text-muted-strong">
          {r.issuer.note} Generated {formatDateTime(r.generatedAt)}.
        </footer>
      </article>
    </div>
  );
}
