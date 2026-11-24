/**
 * Transfer lifecycle state machine. Every status change in the system goes through
 * assertTransition(); the API records each change in transfer_status_history.
 */

export const TRANSFER_STATUSES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAYMENT_PROCESSING',
  'PAYMENT_RECEIVED',
  'COMPLIANCE_REVIEW',
  'PAYOUT_PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/**
 * Allowed transitions.
 *
 * Key rule: once customer funds have been collected (PAYMENT_RECEIVED onwards) a
 * transfer can never go to FAILED or CANCELLED — it must either complete or be
 * refunded. A failed payout attempt is retried (a new payout_attempt) while the
 * transfer stays in PAYOUT_PROCESSING, or the transfer moves to REFUND_PENDING.
 */
export const TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAYMENT_PROCESSING', 'PAYMENT_RECEIVED', 'CANCELLED', 'FAILED'],
  PAYMENT_PROCESSING: ['PAYMENT_RECEIVED', 'FAILED'],
  PAYMENT_RECEIVED: ['COMPLIANCE_REVIEW', 'PAYOUT_PROCESSING', 'REFUND_PENDING'],
  COMPLIANCE_REVIEW: ['PAYOUT_PROCESSING', 'REFUND_PENDING'],
  PAYOUT_PROCESSING: ['COMPLETED', 'COMPLIANCE_REVIEW', 'REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export const TERMINAL_STATUSES: readonly TransferStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'];

/** Statuses in which EBK's payment partner holds collected customer funds. */
export const FUNDS_COLLECTED_STATUSES: readonly TransferStatus[] = [
  'PAYMENT_RECEIVED',
  'COMPLIANCE_REVIEW',
  'PAYOUT_PROCESSING',
  'REFUND_PENDING',
];

export class InvalidTransitionError extends Error {
  constructor(public readonly from: TransferStatus, public readonly to: TransferStatus) {
    super(`Transfer cannot move from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function isTransferStatus(v: string): v is TransferStatus {
  return (TRANSFER_STATUSES as readonly string[]).includes(v);
}

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TransferStatus, to: TransferStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(s: TransferStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

/** Customer-facing wording. Admin screens show the raw status code as well. */
export const STATUS_LABELS: Record<TransferStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_PAYMENT: { label: 'Awaiting payment', tone: 'warning' },
  PAYMENT_PROCESSING: { label: 'Payment processing', tone: 'info' },
  PAYMENT_RECEIVED: { label: 'Payment received', tone: 'info' },
  COMPLIANCE_REVIEW: { label: 'Under review', tone: 'warning' },
  PAYOUT_PROCESSING: { label: 'Paying out', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  REFUND_PENDING: { label: 'Refund pending', tone: 'warning' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
};
