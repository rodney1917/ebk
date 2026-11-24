/**
 * PREVIEW-ONLY minimal stand-in for react-hook-form (+ @hookform/resolvers/zod).
 * The application depends on the real packages; this exists only for offline previews.
 */
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ZodSchema } from 'zod';

type Errors = Record<string, { message?: string } | undefined>;
type Resolver = (values: Record<string, unknown>) => Promise<{ values: Record<string, unknown>; errors: Errors }>;

export function zodResolver(schema: ZodSchema): Resolver {
  return async (values) => {
    const r = schema.safeParse(values);
    if (r.success) return { values: r.data as Record<string, unknown>, errors: {} };
    const errors: Errors = {};
    for (const i of r.error.issues) { const k = String(i.path[0]); errors[k] ??= { message: i.message }; }
    return { values: {}, errors };
  };
}

export function useForm<T extends Record<string, unknown>>({ resolver, defaultValues = {} as Partial<T> }: { resolver?: Resolver; defaultValues?: Partial<T> }) {
  const values = useRef<Record<string, unknown>>({ ...defaultValues });
  const [errors, setErrors] = useState<Errors>({});
  const [isSubmitting, setSubmitting] = useState(false);

  const register = (name: keyof T & string) => ({
    name,
    ref: (el: HTMLInputElement | HTMLSelectElement | null) => {
      if (!el || el.dataset.rhf) return;
      el.dataset.rhf = '1';
      const v = values.current[name];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v;
      else if (v !== undefined) el.value = String(v);
    },
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const t = e.target;
      values.current[name] = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value;
      if (errors[name]) setErrors((p) => ({ ...p, [name]: undefined }));
    },
    onBlur: () => undefined,
  });

  const handleSubmit = (fn: (v: T) => unknown) => async (e?: FormEvent) => {
    e?.preventDefault();
    const res = resolver ? await resolver(values.current) : { values: values.current, errors: {} };
    setErrors(res.errors);
    if (Object.keys(res.errors).length) return;
    setSubmitting(true);
    try { await fn(res.values as T); } finally { setSubmitting(false); }
  };

  return {
    register,
    handleSubmit,
    formState: { errors: errors as { [K in keyof T]?: { message?: string } }, isSubmitting },
    setError: (name: keyof T & string, err: { message?: string }) => setErrors((p) => ({ ...p, [name]: err })),
    reset: (v: Partial<T>) => { values.current = { ...v }; },
    watch: (name: keyof T & string) => values.current[name],
  };
}
