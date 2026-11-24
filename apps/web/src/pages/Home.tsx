import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isTerminal, parseAmount, toDecimalString, type TransferStatus } from '@ebk/core';
import {
  Alert, Badge, ButtonLink, Card, CardHeader, EmptyState, ErrorState, FlagZM, IconChevronRight, IconClock, IconExchange,
  IconHelp, IconList, IconPhone, IconPlus, IconSend, IconShield, IconUsers, MoneyText, RateKindBadge, Skeleton, cx,
} from '../design-system';
import { api, useAuth } from '../lib/auth';
import { formatMoneyDto, formatRate, initials, relativeDay } from '../lib/format';
import type { KycStatus, TransferDto } from '../lib/types';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const KYC_COPY: Record<KycStatus, { tone: 'success' | 'warning' | 'danger' | 'info'; title: string; body: string } | null> = {
  VERIFIED: null,
  NOT_STARTED: { tone: 'warning', title: 'Verify your identity to start sending', body: 'It takes a few minutes. You’ll need a photo ID and proof of address.' },
  PENDING: { tone: 'info', title: 'Verification in progress', body: 'We’re checking your documents. We’ll let you know as soon as it’s done.' },
  IN_REVIEW: { tone: 'info', title: 'Verification under review', body: 'Our compliance team is reviewing your details.' },
  REJECTED: { tone: 'danger', title: 'We couldn’t verify your identity', body: 'Please contact support so we can help.' },
  RESUBMISSION_REQUIRED: { tone: 'warning', title: 'We need another document', body: 'Please upload a clearer copy to continue.' },
};

export function StatusBadge({ t }: { t: Pick<TransferDto, 'statusLabel' | 'statusTone' | 'status'> }) {
  return <Badge tone={t.statusTone} dot={!isTerminal(t.status as TransferStatus)}>{t.statusLabel}</Badge>;
}

export function TransferRow({ t }: { t: TransferDto }) {
  return (
    <Link to={`/transfers/${t.id}`} className="flex items-center gap-4 rounded-2xl px-3 py-3 -mx-3 hover:bg-mint-50/70 focus-visible:bg-mint-50">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-mint-100 text-emerald-700 text-sm font-bold">{initials(t.recipient.fullName)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{t.recipient.fullName}</span>
        <span className="block truncate text-sm text-muted-strong">{relativeDay(t.createdAt)} · {t.recipient.network}</span>
      </span>
      <span className="text-right">
        <MoneyText value={t.sendAmount} className="block font-semibold text-ink" />
        <span className="mt-1 block"><StatusBadge t={t} /></span>
      </span>
    </Link>
  );
}

function QuickCalculator() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('100');
  const [debounced, setDebounced] = useState(amount);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), 350);
    return () => clearTimeout(id);
  }, [amount]);
  const quote = useQuery({
    queryKey: ['estimate', debounced],
    queryFn: () => api.quotes.estimate({ corridorId: 'GB-ZM', payoutMethod: 'MOBILE_MONEY', sendAmount: debounced }),
    enabled: /^\d+(\.\d{1,2})?$/.test(debounced) && Number(debounced) > 0,
    retry: false,
  });

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-navy-900 text-white p-6 sm:p-7 ebk-grid-bg">
      <div className="absolute -right-16 -top-16 size-56 rounded-full bg-emerald-600/25 blur-2xl" aria-hidden />
      <div className="relative">
        <div className="flex items-center gap-2 text-mint-300 text-sm font-semibold">
          <FlagZM /> Send to Zambia · MTN MoMo & Airtel Money
        </div>
        <h2 className="mt-2 text-2xl sm:text-[28px] font-bold tracking-tight">Your money. Your world.</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block rounded-2xl bg-white/8 ring-1 ring-white/15 px-4 py-3 focus-within:ring-emerald-500">
            <span className="text-xs font-semibold uppercase tracking-wide text-mint-300">You send</span>
            <span className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-bold text-mint-300">£</span>
              <input
                value={amount}
                inputMode="decimal"
                aria-label="Amount to send in GBP"
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, '').replace(/^(\d*\.\d{0,2}).*$/, '$1'))}
                className="ebk-amount w-full bg-transparent text-2xl font-bold outline-none"
              />
            </span>
          </label>
          <div className="rounded-2xl bg-white px-4 py-3 text-ink">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-strong">They receive</span>
            <span className="mt-1 block text-2xl font-bold ebk-amount" aria-live="polite">
              {quote.data ? formatMoneyDto(quote.data.recipientAmount) : quote.isFetching ? <Skeleton className="h-8 w-32" /> : '—'}
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-mint-300">
          {quote.data ? (
            <>
              <span className="ebk-amount">{formatRate(quote.data.rate.value, 'GBP', 'ZMW')}</span>
              <span aria-hidden>·</span>
              <span>Fee {formatMoneyDto(quote.data.fee)}</span>
              <RateKindBadge kind={quote.data.rate.kind} />
            </>
          ) : quote.error ? (
            <span className="text-warning-50">{(quote.error as Error).message}</span>
          ) : (
            <span>Enter an amount to see an estimate</span>
          )}
        </div>
        <button
          onClick={() => navigate(`/send?amount=${encodeURIComponent(amount)}`)}
          className="mt-5 inline-flex h-12 items-center gap-2 rounded-xl bg-emerald-600 px-6 font-semibold hover:bg-emerald-500"
        >
          <IconSend /> Send money
        </button>
      </div>
    </div>
  );
}

const ACTIONS = [
  { to: '/send', label: 'Send money', icon: IconSend, note: 'UK to Zambia' },
  { to: '/send', label: 'Exchange rates', icon: IconExchange, note: 'GBP → ZMW' },
  { to: '/recipients', label: 'Recipients', icon: IconUsers, note: 'Saved people' },
  { to: '/transfers', label: 'Transactions', icon: IconList, note: 'Track & receipts' },
  { to: '/airtime', label: 'Airtime & data', icon: IconPhone, note: 'Coming soon' },
  { to: '/help', label: 'Help & support', icon: IconHelp, note: 'We’re here' },
];

export function HomePage() {
  const { me } = useAuth();
  const transfers = useQuery({ queryKey: ['transfers', 'recent'], queryFn: () => api.transfers.list({ limit: 20 }) });
  const beneficiaries = useQuery({ queryKey: ['beneficiaries'], queryFn: api.beneficiaries.list });
  const kyc = me?.profile?.kycStatus ?? 'NOT_STARTED';
  const kycCopy = KYC_COPY[kyc];

  const items = transfers.data?.items ?? [];
  const inProgress = items.filter((t) => !isTerminal(t.status));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const sentThisMonth = items
    .filter((t) => t.status === 'COMPLETED' && new Date(t.createdAt) >= monthStart)
    .reduce((s, t) => s + parseAmount(t.sendAmount.amount, 2), 0n);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted-strong">{greeting()},</p>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">{me?.profile?.firstName ?? 'there'}</h1>
        </div>
        {kyc === 'VERIFIED' && <Badge tone="success"><IconShield size={14} /> Identity verified</Badge>}
      </div>

      {kycCopy && <Alert tone={kycCopy.tone} title={kycCopy.title}>{kycCopy.body}</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <QuickCalculator />
        <Card>
          <CardHeader title="This month" subtitle="Completed transfers" />
          <p className="text-3xl font-bold tracking-tight ebk-amount">
            {transfers.isLoading ? <Skeleton className="h-9 w-36" /> : formatMoneyDto({ amount: toDecimalString(sentThisMonth, 2), currency: 'GBP' })}
          </p>
          <p className="mt-1 text-sm text-muted-strong">Sent to your recipients in Zambia</p>
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink mb-2">Updates</p>
            {inProgress.length === 0 ? (
              <p className="text-sm text-muted-strong">No transfers in progress.</p>
            ) : (
              <ul className="space-y-2">
                {inProgress.slice(0, 3).map((t) => (
                  <li key={t.id}>
                    <Link to={`/transfers/${t.id}`} className="flex items-center gap-2 text-sm hover:underline">
                      <IconClock size={16} className="text-emerald-700 shrink-0" />
                      <span className="truncate">{t.statusLabel}: <MoneyText value={t.recipientAmount} className="font-semibold" /> to {t.recipient.fullName.split(' ')[0]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <section aria-labelledby="quick-actions">
        <h2 id="quick-actions" className="sr-only">Quick actions</h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {ACTIONS.map(({ to, label, icon: Icon, note }) => (
            <Link key={label} to={to} className="group rounded-2xl bg-white border border-line/70 p-3 sm:p-4 text-center shadow-[var(--shadow-card)] hover:border-emerald-600/40">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-mint-100 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition-colors"><Icon /></span>
              <span className="mt-2 block text-[13px] font-semibold text-ink leading-tight">{label}</span>
              <span className="hidden sm:block text-xs text-muted-strong mt-0.5">{note}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Recent activity" action={<Link to="/transfers" className="text-sm font-semibold text-emerald-700 hover:underline">See all</Link>} />
          {transfers.isLoading ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : transfers.error ? (
            <ErrorState error={transfers.error} onRetry={() => transfers.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState icon={<IconSend />} title="No transfers yet" body="Your first transfer to Zambia will show up here." action={<ButtonLink to="/send">Send money</ButtonLink>} />
          ) : (
            <div>{items.slice(0, 5).map((t) => <TransferRow key={t.id} t={t} />)}</div>
          )}
        </Card>

        <Card>
          <CardHeader title="Recipients" action={<Link to="/recipients" className="text-sm font-semibold text-emerald-700 hover:underline">Manage</Link>} />
          {beneficiaries.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <ul className="space-y-1">
              {(beneficiaries.data ?? []).slice(0, 4).map((b) => (
                <li key={b.id}>
                  <Link to={`/send?recipient=${b.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 -mx-2 hover:bg-mint-50/70">
                    <span className="grid size-10 place-items-center rounded-full bg-navy-900 text-white text-sm font-bold">{initials(b.fullName)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{b.nickname ?? b.fullName}</span>
                      <span className="block truncate text-sm text-muted-strong">{b.mobileOperator?.name} · {b.mobileNumberMasked}</span>
                    </span>
                    <IconChevronRight className="text-muted" />
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/recipients?new=1" className={cx('flex items-center gap-3 rounded-xl px-2 py-2 -mx-2 text-emerald-700 font-semibold hover:bg-mint-50/70')}>
                  <span className="grid size-10 place-items-center rounded-full border-2 border-dashed border-emerald-600/40"><IconPlus /></span>
                  Add recipient
                </Link>
              </li>
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
