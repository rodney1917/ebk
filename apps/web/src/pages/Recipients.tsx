import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import {
  Alert, Button, Card, EmptyState, ErrorState, IconEdit, IconPlus, IconSearch, IconSend, IconTrash, IconUsers, Input, Modal, PageHeader,
  Select, Skeleton, ButtonLink,
} from '../design-system';
import { ApiError } from '../lib/api';
import { api } from '../lib/auth';
import { initials } from '../lib/format';
import type { Beneficiary, BeneficiaryInput } from '../lib/types';

const schema = z.object({
  fullName: z.string().trim().min(3, 'Enter the recipient’s full name').max(120).refine((v) => v.includes(' '), 'Enter first and last name, as registered on the mobile money account'),
  nickname: z.string().trim().max(40).optional(),
  mobileOperatorCode: z.string().min(1, 'Choose a mobile money network'),
  mobileNumber: z.string().trim().regex(/^[+\d\s()-]{9,16}$/, 'Enter a valid Zambian mobile number'),
});
type FormValues = z.infer<typeof schema>;

export function BeneficiaryForm({ initial, onSaved, onCancel }: { initial?: Beneficiary; onSaved: (b: Beneficiary) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const corridors = useQuery({ queryKey: ['corridors'], queryFn: api.corridors });
  const operators = corridors.data?.[0]?.mobileOperators ?? [];
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: initial?.fullName ?? '',
      nickname: initial?.nickname ?? '',
      mobileOperatorCode: initial?.mobileOperator?.code ?? '',
      mobileNumber: initial?.mobileNumber?.replace(/^\+260/, '0') ?? '',
    },
  });
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const body: BeneficiaryInput = { ...v, countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY' };
    try {
      const saved = initial ? await api.beneficiaries.update(initial.id, body) : await api.beneficiaries.create(body);
      await qc.invalidateQueries({ queryKey: ['beneficiaries'] });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.body.fields?.length) {
        for (const f of e.body.fields) setError(f.path as keyof FormValues, { message: f.message });
      } else setFormError(e instanceof Error ? e.message : 'Could not save recipient');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Input label="Full name" autoComplete="off" placeholder="As registered with the mobile money account" error={errors.fullName?.message} {...register('fullName')} />
      <Select
        label="Mobile money network"
        placeholder="Choose network"
        options={operators.map((o) => ({ value: o.code, label: o.name }))}
        error={errors.mobileOperatorCode?.message}
        {...register('mobileOperatorCode')}
      />
      <Input label="Mobile number" inputMode="tel" placeholder="e.g. 096 123 4567" prefix="+260" hint="Zambian number registered for mobile money" error={errors.mobileNumber?.message} {...register('mobileNumber')} />
      <Input label="Nickname (optional)" placeholder="e.g. Mum" error={errors.nickname?.message} {...register('nickname')} />
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{initial ? 'Save changes' : 'Save recipient'}</Button>
      </div>
    </form>
  );
}

export function RecipientsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ['beneficiaries'], queryFn: api.beneficiaries.list });
  const [editing, setEditing] = useState<Beneficiary | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Beneficiary | null>(null);
  const [search, setSearch] = useState('');
  const remove = useMutation({
    mutationFn: (id: string) => api.beneficiaries.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['beneficiaries'] }); setDeleting(null); },
  });

  useEffect(() => {
    if (params.get('new') === '1') { setEditing('new'); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const rows = (list.data ?? []).filter((b) => `${b.fullName} ${b.nickname ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader title="Recipients" subtitle="People you send money to in Zambia" action={<Button icon={<IconPlus />} onClick={() => setEditing('new')}>Add recipient</Button>} />
      <Card>
        {list.isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={<IconUsers />} title="No recipients yet" body="Add the people you send money to. We’ll check their mobile money details before you send." action={<Button icon={<IconPlus />} onClick={() => setEditing('new')}>Add your first recipient</Button>} />
        ) : (
          <>
            <div className="relative mb-4 max-w-sm">
              <IconSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipients" aria-label="Search recipients" className="h-11 w-full rounded-xl border border-line-strong bg-white pl-10 pr-3 text-[15px] focus:outline-none focus:ring-4 focus:ring-emerald-600/15 focus:border-emerald-600" />
            </div>
            <ul className="divide-y divide-line">
              {rows.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-4 py-4">
                  <span className="grid size-12 place-items-center rounded-full bg-navy-900 text-white font-bold">{initials(b.fullName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{b.fullName} {b.nickname && <span className="font-normal text-muted-strong">· {b.nickname}</span>}</span>
                    <span className="block text-sm text-muted-strong">{b.mobileOperator?.name} · {b.mobileNumberMasked}</span>
                  </span>
                  <span className="flex gap-2">
                    <ButtonLink to={`/send?recipient=${b.id}`} size="sm" variant="primary"><IconSend size={16} /> Send</ButtonLink>
                    <Button size="sm" variant="secondary" aria-label={`Edit ${b.fullName}`} onClick={() => setEditing(b)}><IconEdit size={16} /></Button>
                    <Button size="sm" variant="danger" aria-label={`Delete ${b.fullName}`} onClick={() => setDeleting(b)}><IconTrash size={16} /></Button>
                  </span>
                </li>
              ))}
              {rows.length === 0 && <li className="py-8 text-center text-sm text-muted-strong">No recipients match “{search}”.</li>}
            </ul>
          </>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add recipient' : 'Edit recipient'} description="Mobile money in Zambia: MTN MoMo or Airtel Money.">
        {editing !== null && <BeneficiaryForm initial={editing === 'new' ? undefined : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete recipient?"
        description={deleting ? `${deleting.fullName} will be removed from your recipients. Past transfers and receipts are kept.` : undefined}
        footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Keep</Button><Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete</Button></>}
      >
        {remove.error && <Alert tone="danger">{(remove.error as Error).message}</Alert>}
      </Modal>
    </>
  );
}
