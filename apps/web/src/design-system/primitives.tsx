import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'navy';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-700 shadow-sm',
  navy: 'bg-navy-900 text-white hover:bg-navy-800 shadow-sm',
  secondary: 'bg-white text-ink border border-line-strong hover:border-emerald-600 hover:text-emerald-700',
  ghost: 'bg-transparent text-ink hover:bg-mint-50',
  danger: 'bg-white text-danger-700 border border-danger-700/30 hover:bg-danger-50',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[15px] gap-2',
  lg: 'h-14 px-6 text-base gap-2.5',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', block = false) =>
  cx(
    'inline-flex items-center justify-center rounded-[var(--radius-control)] font-semibold transition-colors',
    'disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap',
    variants[variant], sizes[size], block && 'w-full',
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} className={cx(buttonClass(variant, size, block), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', block, className, ...rest }: LinkProps & { variant?: Variant; size?: Size; block?: boolean }) {
  return <Link className={cx(buttonClass(variant, size, block), className)} {...rest} />;
}

// ---------------------------------------------------------------- Card
export function Card({ className, padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return <div className={cx('bg-surface rounded-[var(--radius-card)] border border-line/70 shadow-[var(--shadow-card)]', padded && 'p-5 sm:p-6', className)} {...rest} />;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-[17px] font-semibold text-ink tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-strong mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Badge
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';
const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-muted-strong ring-line',
  info: 'bg-info-50 text-info-700 ring-info-700/15',
  success: 'bg-success-50 text-success-700 ring-success-700/15',
  warning: 'bg-warning-50 text-warning-700 ring-warning-700/15',
  danger: 'bg-danger-50 text-danger-700 ring-danger-700/15',
  brand: 'bg-mint-100 text-emerald-700 ring-emerald-600/15',
};

export function Badge({ tone = 'neutral', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Loading
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx('animate-spin', className)} role="status" aria-label="Loading">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('ebk-skeleton rounded-lg', className)} aria-hidden />;
}

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-muted-strong" aria-live="polite">
      <Spinner /> <span className="text-sm">{label}…</span>
    </div>
  );
}

// ---------------------------------------------------------------- Page header
export function PageHeader({ title, subtitle, action, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="text-muted-strong mt-1">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
