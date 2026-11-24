/**
 * Double-entry ledger journals.
 *
 * EBK does not hold customer funds. The ledger records EBK's view of positions held
 * at authorised partners, so every movement can be reconciled against partner
 * statements:
 *
 *   COLLECTION_CLEARING:<provider>:<ccy>  asset   funds collected by a payment partner, awaiting settlement
 *   PAYOUT_FUNDING:<provider>:<ccy>       asset   pre-funded float at a payout partner
 *   CUSTOMER_TRANSFERS:<ccy>              liability amounts owed onward to recipients (or back to senders)
 *   FEE_REVENUE:<ccy>                     revenue  EBK transfer fees
 *   FX_CONVERSION:<ccy>                   equity/contra  FX conversion position per currency
 *
 * Journals are append-only. A correction is a new reversing journal, never an edit.
 * Each journal must balance per currency (debits = credits).
 */
import type { CurrencyCode } from './money.js';

export type EntrySide = 'DEBIT' | 'CREDIT';

export interface JournalLine {
  account: string;
  side: EntrySide;
  amountMinor: bigint; // always positive
  currency: CurrencyCode;
}

export type JournalEventType =
  | 'PAYMENT_RECEIVED'
  | 'PAYOUT_COMPLETED'
  | 'REFUND_COMPLETED'
  | 'REVERSAL';

export interface Journal {
  eventType: JournalEventType;
  transferReference: string;
  lines: JournalLine[];
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export const accounts = {
  collectionClearing: (provider: string, ccy: string) => `COLLECTION_CLEARING:${provider}:${ccy}`,
  payoutFunding: (provider: string, ccy: string) => `PAYOUT_FUNDING:${provider}:${ccy}`,
  customerTransfers: (ccy: string) => `CUSTOMER_TRANSFERS:${ccy}`,
  feeRevenue: (ccy: string) => `FEE_REVENUE:${ccy}`,
  fxConversion: (ccy: string) => `FX_CONVERSION:${ccy}`,
};

/** Throws if any line is non-positive or any currency does not balance. */
export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) throw new LedgerError('A journal needs at least two lines');
  const totals = new Map<string, bigint>();
  for (const l of lines) {
    if (l.amountMinor <= 0n) throw new LedgerError(`Ledger amounts must be positive (${l.account})`);
    const signed = l.side === 'DEBIT' ? l.amountMinor : -l.amountMinor;
    totals.set(l.currency, (totals.get(l.currency) ?? 0n) + signed);
  }
  for (const [ccy, total] of totals) {
    if (total !== 0n) throw new LedgerError(`Journal does not balance in ${ccy} (difference ${total})`);
  }
}

function journal(eventType: JournalEventType, ref: string, lines: JournalLine[]): Journal {
  const nonZero = lines.filter((l) => l.amountMinor !== 0n);
  assertBalanced(nonZero);
  return { eventType, transferReference: ref, lines: nonZero };
}

export interface TransferAmounts {
  reference: string;
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  sendAmountMinor: bigint;
  feeMinor: bigint;
  recipientAmountMinor: bigint;
  collectionProvider: string;
  payoutProvider: string;
}

/** Customer's payment confirmed by the collection partner. */
export function paymentReceivedJournal(t: TransferAmounts): Journal {
  const c = t.sourceCurrency;
  return journal('PAYMENT_RECEIVED', t.reference, [
    { account: accounts.collectionClearing(t.collectionProvider, c), side: 'DEBIT', amountMinor: t.sendAmountMinor + t.feeMinor, currency: c },
    { account: accounts.customerTransfers(c), side: 'CREDIT', amountMinor: t.sendAmountMinor, currency: c },
    { account: accounts.feeRevenue(c), side: 'CREDIT', amountMinor: t.feeMinor, currency: c },
  ]);
}

/** Recipient paid by the payout partner. Converts the obligation across currencies. */
export function payoutCompletedJournal(t: TransferAmounts): Journal {
  const s = t.sourceCurrency;
  const d = t.destinationCurrency;
  return journal('PAYOUT_COMPLETED', t.reference, [
    { account: accounts.customerTransfers(s), side: 'DEBIT', amountMinor: t.sendAmountMinor, currency: s },
    { account: accounts.fxConversion(s), side: 'CREDIT', amountMinor: t.sendAmountMinor, currency: s },
    { account: accounts.fxConversion(d), side: 'DEBIT', amountMinor: t.recipientAmountMinor, currency: d },
    { account: accounts.payoutFunding(t.payoutProvider, d), side: 'CREDIT', amountMinor: t.recipientAmountMinor, currency: d },
  ]);
}

/** Funds returned to the sender. Fee refund is a policy decision passed in explicitly. */
export function refundCompletedJournal(t: TransferAmounts, refundFee: boolean): Journal {
  const c = t.sourceCurrency;
  const fee = refundFee ? t.feeMinor : 0n;
  return journal('REFUND_COMPLETED', t.reference, [
    { account: accounts.customerTransfers(c), side: 'DEBIT', amountMinor: t.sendAmountMinor, currency: c },
    { account: accounts.feeRevenue(c), side: 'DEBIT', amountMinor: fee, currency: c },
    { account: accounts.collectionClearing(t.collectionProvider, c), side: 'CREDIT', amountMinor: t.sendAmountMinor + fee, currency: c },
  ]);
}

/** Exact mirror of an earlier journal — the only way to "undo" a posting. */
export function reversalJournal(original: Journal): Journal {
  return journal(
    'REVERSAL',
    original.transferReference,
    original.lines.map((l) => ({ ...l, side: l.side === 'DEBIT' ? 'CREDIT' : 'DEBIT' })),
  );
}

/** Balance of an account from its lines (debit-positive). */
export function accountBalance(lines: JournalLine[], account: string): bigint {
  return lines
    .filter((l) => l.account === account)
    .reduce((sum, l) => sum + (l.side === 'DEBIT' ? l.amountMinor : -l.amountMinor), 0n);
}
