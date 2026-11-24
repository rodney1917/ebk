import { cx } from './primitives';

/**
 * Placeholder EBK mark (two nodes joined by an arc — "Connect"). Replace the SVG
 * with the approved EBK logo artwork when final files are supplied; the component
 * API stays the same.
 */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#102A35" />
      <path d="M18 40c6-14 22-14 28 0" fill="none" stroke="#16866C" strokeWidth="6" strokeLinecap="round" />
      <circle cx="18" cy="40" r="5" fill="#B7D9CD" />
      <circle cx="46" cy="40" r="5" fill="#B7D9CD" />
      <circle cx="32" cy="24" r="4" fill="#FFFFFF" />
    </svg>
  );
}

export function Logo({ inverted, className, showTagline }: { inverted?: boolean; className?: string; showTagline?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="leading-none">
        <span className={cx('block text-xl font-extrabold tracking-tight', inverted ? 'text-white' : 'text-navy-900')}>
          EBK
        </span>
        {showTagline && <span className={cx('block text-[11px] font-medium mt-1', inverted ? 'text-mint-300' : 'text-muted-strong')}>Empower. Bank. Connect.</span>}
      </span>
      <span className="sr-only">EBK — Empower Bank Konnect</span>
    </span>
  );
}

export const FlagGB = () => (
  <svg width="20" height="14" viewBox="0 0 60 42" aria-label="United Kingdom" role="img" className="rounded-[3px]">
    <rect width="60" height="42" fill="#012169" />
    <path d="M0 0l60 42M60 0L0 42" stroke="#fff" strokeWidth="8" />
    <path d="M0 0l60 42M60 0L0 42" stroke="#C8102E" strokeWidth="3" />
    <path d="M30 0v42M0 21h60" stroke="#fff" strokeWidth="12" />
    <path d="M30 0v42M0 21h60" stroke="#C8102E" strokeWidth="7" />
  </svg>
);

export const FlagZM = () => (
  <svg width="20" height="14" viewBox="0 0 60 42" aria-label="Zambia" role="img" className="rounded-[3px]">
    <rect width="60" height="42" fill="#198A00" />
    <rect x="39" y="18" width="7" height="24" fill="#DE2010" />
    <rect x="46" y="18" width="7" height="24" fill="#000" />
    <rect x="53" y="18" width="7" height="24" fill="#EF7D00" />
    <path d="M48 8c3-3 8-3 10 0-3 0-5 2-5 4-2-2-4-3-5-4z" fill="#EF7D00" />
  </svg>
);
