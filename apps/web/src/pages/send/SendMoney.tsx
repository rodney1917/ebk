import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, AmountField, Button, Card, CardHeader, cx, DescriptionList, EmptyState, FlagGB, FlagZM, IconCheck, IconChevronLeft,
  IconClock, IconPlus, IconShield, Modal, MoneyText, PageHeader, RateKindBadge, Skeleton,
} from '../../design-system';
import { ApiError } from '../../lib/api';
import { api, IS_DEMO, useAuth } from '../../lib/auth';
import { formatMoneyDto, formatRate, initials, newIdempotencyKey } from '../../lib/format';
import { parseAmount } from '@ebk/core';
import type { Beneficiary, QuoteDto } from '../../lib/types';
import { BeneficiaryForm } from '../Recipients';

type Step = 'amount' | 'recipient' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'amount', label: 'Amount' },
  { id: 'recipient', label: 'Recipient' },
  { id: 'review', label: 'Review & pay' },
];
const CORRIDOR = 'GB-ZM';
const METHOD = 'MOBILE_MONEY';

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex items-center gap-2 mb-6" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex flex-1 items-center gap-2" aria-current={i === idx ? 'step' : undefined}>
          <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', i < idx ? 'bg-emerald-600 text-white' : i === idx ? 'bg-navy-900 text-white' : 'bg-line text-muted-strong')}>
            {i < idx ? <IconCheck size={14} /> : i + 1}
          </span>
          <span className={cx('text-sm font-semibold hidden sm:inline', i === idx ? 'text-ink' : 'text-muted-strong')}>{s.label}</span>
          {i < STEPS.length - 1 && <span className={cx('h-0.5 flex-1 rounded', i < idx ? 'bg-emerald-600' : 'bg-line')} />}
        </li>
      ))}
    </ol>
  );
}

function Breakdown({ q }: { q: QuoteDto }) {
  return (
    <DescriptionList
      items={[
        { label: 'Exchange rate', value: <span className="inline-flex flex-wrap items-center justify-end gap-2">{formatRate(q.rate.value, 'GBP', 'ZMW')} <RateKindBadge kind={q.rate.kind} /></span> },
        { label: 'Amount converted', value: formatMoneyDto(q.sendAmount) },
        { label: 'EBK fee', value: formatMoneyDto(q.fee) },
        { label: 'Total you pay', value: formatMoneyDto(q.totalPayable), emphasis: true },
        { label: 'Recipient gets', value: <span className="text-emerald-700">{formatMoneyDto(q.recipientAmount)}</span>, emphasis: true },
      ]}
    />
  );
}

function useCountdown(iso: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  return { seconds: s, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
}

export function SendMoneyPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState(params.get('amount') ?? '100');
  const [debounced, setDebounced] = useState(amount);
  const [recipientId, setRecipientId] = useState<string | null>(params.get('recipient'));
  const [adding, setAdding] = useState(false);
  const [locked, setLocked] = useState<QuoteDto | null>(null);
  const idemKeys = useRef<{ create: string; confirm: string } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), 300);
    return () => clearTimeout(id);
  }, [amount]);

  const validAmount = /^\d+(\.\d{1,2})?$/.test(debounced) && Number(debounced) > 0;
  const estimate = useQuery({
    queryKey: ['estimate', debounced],
    queryFn: () => api.quotes.estimate({ corridorId: CORRIDOR, payoutMethod: METHOD, sendAmount: debounced }),
    enabled: validAmount,
    retry: false,
  });
  const beneficiaries = useQuery({ queryKey: ['beneficiaries'], queryFn: api.beneficiaries.list });
  const recipient = useMemo(() => beneficiaries.data?.find((b) => b.id === recipientId) ?? null, [beneficiaries.data, recipientId]);
  const corridors = useQuery({ queryKey: ['corridors'], queryFn: api.corridors });
  // Network per-transfer limit (e.g. MTN MoMo up to K10,000). Checked here for a clear message; the API enforces it too.
  const limitWarning = useMemo(() => {
    const op = corridors.data?.[0]?.mobileOperators.find((o) => o.code === recipient?.mobileOperator?.code);
    if (!op?.maxPayout || !estimate.data) return null;
    const max = parseAmount(op.maxPayout, 2);
    if (parseAmount(estimate.data.recipientAmount.amount, 2) <= max) return null;
    return `${op.name} accepts up to ${formatMoneyDto({ amount: op.maxPayout, currency: 'ZMW' })} per transfer. Go back and send a smaller amount, or choose a different recipient.`;
  }, [corridors.data, recipient, estimate.data]);
  const countdown = useCountdown(locked?.expiresAt ?? null);
  const verified = me?.profile?.kycStatus === 'VERIFIED';

  const lockQuote = useMutation({
    mutationFn: () => api.quotes.lock({ corridorId: CORRIDOR, payoutMethod: METHOD, sendAmount: debounced }),
    onSuccess: (q) => {
      setLocked(q);
      idemKeys.current = { create: newIdempotencyKey(), confirm: newIdempotencyKey() }; // one pair per confirmed quote
      setStep('review');
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!locked?.id || !recipient || !idemKeys.current) throw new Error('Missing quote or recipient');
      const transfer = await api.transfers.create({ quoteId: locked.id, beneficiaryId: recipient.id }, idemKeys.current.create);
      const payment = await api.transfers.confirm(transfer.id, idemKeys.current.confirm);
      return { transfer, payment };
    },
    onSuccess: ({ transfer, payment }) => {
      // Payment details are entered on the payment partner's hosted page, never in EBK.
      if (payment.checkoutUrl) window.location.assign(payment.checkoutUrl);
      else navigate(`/transfers/${transfer.id}?new=1`);
    },
  });

  const amountError = estimate.error instanceof ApiError ? estimate.error.message : !validAmount && amount !== '' ? 'Enter a valid amount' : undefined;
  const expired = countdown?.seconds === 0;

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Send money"
        subtitle="United Kingdom → Zambia"
        back={step !== 'amount' && (
          <button onClick={() => setStep(step === 'review' ? 'recipient' : 'amount')} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
            <IconChevronLeft size={16} /> Back
          </button>
        )}
      />
      <Stepper current={step} />

      {step === 'amount' && (
        <Card>
          <div className="space-y-3">
            <AmountField id="send" label="You send" currency="GBP" flag={<FlagGB />} value={amount} onChange={setAmount} error={amountError} hint="Min £10 · Max £2,000 per transfer" />
            <AmountField id="receive" label="Recipient gets" currency="ZMW" flag={<FlagZM />} readOnly value={estimate.data ? estimate.data.recipientAmount.amount : ''} />
          </div>
          <div className="mt-4 rounded-2xl bg-canvas px-4 py-1">
            {estimate.data ? <Breakdown q={estimate.data} /> : <div className="py-4 space-y-3"><Skeleton className="h-5" /><Skeleton className="h-5 w-2/3" /></div>}
          </div>
          {estimate.data?.rate.kind !== 'LIVE' && estimate.data && (
            <p className="mt-3 text-sm text-muted-strong">
              This is {estimate.data.rate.kind === 'SANDBOX' ? 'a sandbox test' : 'an estimated'} rate. Your rate is confirmed and locked on the review step.
            </p>
          )}
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
            <span className="grid size-10 place-items-center rounded-xl bg-mint-100 text-emerald-700"><IconShield /></span>
            <div className="text-sm">
              <p className="font-semibold">Paid to mobile money</p>
              <p className="text-muted-strong">MTN MoMo or Airtel Money, via EBK’s authorised payout partners</p>
            </div>
          </div>
          <Button className="mt-6" size="lg" block disabled={!estimate.data} onClick={() => setStep('recipient')}>Continue</Button>
        </Card>
      )}

      {step === 'recipient' && (
        <Card>
          <CardHeader title="Who are you sending to?" subtitle="Choose a saved recipient or add a new one" />
          {beneficiaries.isLoading ? (
            <Skeleton className="h-32" />
          ) : (beneficiaries.data ?? []).length === 0 ? (
            <EmptyState title="No recipients yet" body="Add the person you’re sending to." action={<Button icon={<IconPlus />} onClick={() => setAdding(true)}>Add recipient</Button>} />
          ) : (
            <fieldset>
              <legend className="sr-only">Recipient</legend>
              <div className="space-y-2">
                {beneficiaries.data!.map((b: Beneficiary) => (
                  <label key={b.id} className={cx('flex cursor-pointer items-center gap-4 rounded-2xl border px-4 py-3 transition-colors', recipientId === b.id ? 'border-emerald-600 bg-mint-50 ring-4 ring-emerald-600/10' : 'border-line hover:border-line-strong')}>
                    <input type="radio" name="recipient" className="sr-only" checked={recipientId === b.id} onChange={() => setRecipientId(b.id)} />
                    <span className="grid size-11 place-items-center rounded-full bg-navy-900 text-white text-sm font-bold">{initials(b.fullName)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{b.fullName}{b.nickname && <span className="font-normal text-muted-strong"> · {b.nickname}</span>}</span>
                      <span className="block text-sm text-muted-strong">{b.mobileOperator?.name} · {b.mobileNumberMasked}</span>
                    </span>
                    {recipientId === b.id && <IconCheck className="text-emerald-700" />}
                  </label>
                ))}
              </div>
              <Button variant="ghost" className="mt-3" icon={<IconPlus />} onClick={() => setAdding(true)}>Add a new recipient</Button>
            </fieldset>
          )}
          {limitWarning && <Alert tone="warning" className="mt-4">{limitWarning}</Alert>}
          {lockQuote.error && <Alert tone="danger" className="mt-4">{(lockQuote.error as Error).message}</Alert>}
          <Button className="mt-6" size="lg" block disabled={!recipient || !!limitWarning} loading={lockQuote.isPending} onClick={() => lockQuote.mutate()}>Review transfer</Button>
        </Card>
      )}

      {step === 'review' && locked && recipient && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-strong">{recipient.fullName.split(' ')[0]} receives</p>
                <p className="text-[32px] font-bold tracking-tight text-emerald-700 ebk-amount"><MoneyText value={locked.recipientAmount} /></p>
              </div>
              <div className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold', expired ? 'bg-danger-50 text-danger-700' : 'bg-mint-100 text-emerald-700')} aria-live="polite">
                <IconClock size={16} /> {expired ? 'Rate expired' : `Rate locked for ${countdown?.label}`}
              </div>
            </div>
            <div className="mt-4"><Breakdown q={locked} /></div>
          </Card>
          <Card>
            <CardHeader title="Recipient" action={<button className="text-sm font-semibold text-emerald-700 hover:underline" onClick={() => setStep('recipient')}>Change</button>} />
            <DescriptionList items={[
              { label: 'Name', value: recipient.fullName },
              { label: 'Network', value: recipient.mobileOperator?.name ?? '—' },
              { label: 'Mobile number', value: recipient.mobileNumberMasked ?? '—' },
              { label: 'Country', value: 'Zambia' },
            ]} />
          </Card>

          {!verified && <Alert tone="warning" title="Identity verification required">You can review transfers now, but you’ll need to verify your identity before you can pay.</Alert>}
          {(pay.error || expired) && (
            <Alert tone="danger" action={expired ? <Button size="sm" variant="secondary" onClick={() => lockQuote.mutate()}>Refresh rate</Button> : undefined}>
              {expired ? 'This rate has expired. Refresh to get a new confirmed rate.' : (pay.error as Error).message}
            </Alert>
          )}

          <Button size="lg" block disabled={!verified || expired} loading={pay.isPending} onClick={() => pay.mutate()}>
            Confirm and pay {formatMoneyDto(locked.totalPayable)}
          </Button>
          <p className="text-xs text-muted-strong text-center">
            {IS_DEMO ? 'Demo preview: no payment is taken. ' : ''}
            You’ll pay on our payment partner’s secure page. EBK never sees or stores your card details. By continuing you agree to the <Link to="/help" className="underline">transfer terms</Link>.
          </p>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add recipient" description="Mobile money in Zambia: MTN MoMo or Airtel Money.">
        {adding && <BeneficiaryForm onSaved={(b) => { setRecipientId(b.id); setAdding(false); }} onCancel={() => setAdding(false)} />}
      </Modal>
    </div>
  );
}
