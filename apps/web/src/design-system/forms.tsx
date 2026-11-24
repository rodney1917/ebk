import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from './primitives';

const control =
  'w-full rounded-[var(--radius-control)] bg-white border text-ink placeholder:text-muted transition-colors ' +
  'focus:outline-none focus:ring-4 focus:ring-emerald-600/15 focus:border-emerald-600 disabled:bg-canvas disabled:text-muted';

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">{label}</label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-danger-700">{error}</p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted-strong">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  prefix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, prefix, id, className, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <div className="relative">
        {prefix && <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-strong text-[15px] pointer-events-none">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cx(control, 'h-12 px-3.5 text-[15px]', prefix ? 'pl-[3.75rem]' : '', error ? 'border-danger-700' : 'border-line-strong', className)}
          {...rest}
        />
      </div>
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, options, placeholder, id, className, ...rest }, ref) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={selectId}>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cx(control, 'h-12 px-3.5 text-[15px] appearance-none bg-[length:16px] bg-[right_14px_center] bg-no-repeat', error ? 'border-danger-700' : 'border-line-strong', className)}
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23718096' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
});

/** Large currency amount entry used on the Send screen. */
export function AmountField({
  id, label, currency, flag, value, onChange, readOnly, error, hint,
}: { id: string; label: string; currency: string; flag: ReactNode; value: string; onChange?: (v: string) => void; readOnly?: boolean; error?: string; hint?: ReactNode }) {
  return (
    <div className={cx('rounded-2xl border bg-white px-4 pt-3 pb-3.5 transition-colors focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-600/15', error ? 'border-danger-700' : 'border-line-strong', readOnly && 'bg-mint-50/60')}>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-muted-strong">{label}</label>
      <div className="flex items-center gap-3 mt-1">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange?.(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*$/, '$1'))}
          className="ebk-amount min-w-0 flex-1 bg-transparent text-[28px] sm:text-[32px] font-bold text-ink outline-none placeholder:text-line-strong"
          placeholder="0.00"
        />
        <span className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-line">
          {flag}
          {currency}
        </span>
      </div>
      {error ? <p role="alert" className="text-sm text-danger-700 mt-1">{error}</p> : hint ? <p className="text-sm text-muted-strong mt-1">{hint}</p> : null}
    </div>
  );
}
