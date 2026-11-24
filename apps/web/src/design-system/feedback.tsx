import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';
import { Button, cx } from './primitives';

// ---------------------------------------------------------------- Alert
type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const alertStyles: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: 'bg-info-50 text-info-700 border-info-700/15', icon: <IconInfo /> },
  success: { box: 'bg-success-50 text-success-700 border-success-700/15', icon: <IconCheck /> },
  warning: { box: 'bg-warning-50 text-warning-700 border-warning-700/20', icon: <IconAlert /> },
  danger: { box: 'bg-danger-50 text-danger-700 border-danger-700/20', icon: <IconAlert /> },
};

export function Alert({ tone = 'info', title, children, action, className }: { tone?: AlertTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const s = alertStyles[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-2xl border px-4 py-3.5', s.box, className)}>
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div className="flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5', 'text-ink/80')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Empty & error states
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6">
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-mint-100 text-emerald-700">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-strong">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <EmptyState
      icon={<IconAlert />}
      title="We couldn’t load this"
      body={message}
      action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    />
  );
}

// ---------------------------------------------------------------- Modal (accessible dialog)
export function Modal({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-[var(--radius-card)] bg-white p-0 shadow-[var(--shadow-pop)] backdrop:bg-navy-950/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted-strong">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-strong hover:bg-canvas" aria-label="Close"><IconX /></button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="flex justify-end gap-3 border-t border-line px-6 py-4 bg-canvas/50 rounded-b-[var(--radius-card)]">{footer}</div>}
    </dialog>
  );
}
