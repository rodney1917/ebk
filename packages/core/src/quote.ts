/**
 * Exchange-rate, fee and quote calculation.
 *
 * Model: the customer enters the amount to SEND (source currency). The fee is
 * charged on top, so  totalPayable = sendAmount + fee  and  the whole sendAmount
 * is converted:  recipientAmount = floor(sendAmount × rate).
 *
 * Rounding policy (documented in ARCHITECTURE.md):
 *  - percentage fees round half-up to the minor unit;
 *  - the recipient amount rounds DOWN, so EBK never promises more than it can pay.
 */
import { currencyInfo, divFloor, divRoundHalfUp, MoneyError, type CurrencyCode } from './money.js';

/** Rates are carried as decimal strings with up to 8 dp and scaled to integers. */
export const RATE_SCALE_DP = 8;
const RATE_SCALE = 10n ** BigInt(RATE_SCALE_DP);

/**
 * Where a rate came from. The UI must label each kind differently and must never
 * present ESTIMATED / SANDBOX rates as live.
 *  - LIVE:      from a configured, contracted rate source within its validity window.
 *  - ESTIMATED: indicative only (stale live rate, or manually entered reference rate).
 *  - SANDBOX:   test value for non-production environments. Never used for real money.
 */
export type RateKind = 'LIVE' | 'ESTIMATED' | 'SANDBOX';

export interface ExchangeRate {
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  /** Customer rate (after any margin), decimal string, e.g. "33.85000000" */
  rate: string;
  kind: RateKind;
  source: string; // e.g. "sandbox-config", "provider:xyz"
  fetchedAt: string; // ISO-8601 UTC
  /** After this instant a LIVE rate is downgraded to ESTIMATED. */
  validUntil?: string;
}

export function parseRate(rate: string): bigint {
  const v = rate.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new MoneyError(`Invalid rate: "${rate}"`);
  const [whole, frac = ''] = v.split('.');
  if (frac.length > RATE_SCALE_DP && /[^0]/.test(frac.slice(RATE_SCALE_DP))) {
    throw new MoneyError(`Rate "${rate}" exceeds ${RATE_SCALE_DP} decimal places`);
  }
  const scaled = BigInt(whole! + (frac + '0'.repeat(RATE_SCALE_DP)).slice(0, RATE_SCALE_DP));
  if (scaled <= 0n) throw new MoneyError('Rate must be positive');
  return scaled;
}

/** Effective rate kind at a moment in time: an expired LIVE rate is only an estimate. */
export function effectiveRateKind(rate: ExchangeRate, now: Date): RateKind {
  if (rate.kind === 'LIVE' && rate.validUntil && new Date(rate.validUntil) <= now) return 'ESTIMATED';
  return rate.kind;
}

export function convert(
  amountMinor: bigint,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: string,
): bigint {
  if (amountMinor < 0n) throw new MoneyError('Amount must be non-negative');
  const fromDp = BigInt(currencyInfo(from).minorUnits);
  const toDp = BigInt(currencyInfo(to).minorUnits);
  const r = parseRate(rate);
  // amountMinor / 10^fromDp × r / 10^8 × 10^toDp
  return divFloor(amountMinor * r * 10n ** toDp, RATE_SCALE * 10n ** fromDp);
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export interface FeeRule {
  id: string;
  sourceCurrency: CurrencyCode;
  destinationCountry: string; // ISO 3166-1 alpha-2
  payoutMethod?: string | null; // e.g. "MOBILE_MONEY"; null = any
  /** Inclusive lower bound of send amount band (minor units). */
  minSendMinor: bigint;
  /** Inclusive upper bound; null = unbounded. */
  maxSendMinor: bigint | null;
  fixedFeeMinor: bigint;
  /** Percentage in basis points (1% = 100). */
  percentageBps: number;
  minFeeMinor?: bigint | null;
  maxFeeMinor?: bigint | null;
  priority: number; // higher wins when several rules match
  active: boolean;
}

export interface FeeContext {
  sourceCurrency: CurrencyCode;
  destinationCountry: string;
  payoutMethod: string;
  sendAmountMinor: bigint;
}

export function selectFeeRule(rules: FeeRule[], ctx: FeeContext): FeeRule | null {
  const matches = rules.filter(
    (r) =>
      r.active &&
      r.sourceCurrency === ctx.sourceCurrency &&
      r.destinationCountry === ctx.destinationCountry &&
      (r.payoutMethod == null || r.payoutMethod === ctx.payoutMethod) &&
      ctx.sendAmountMinor >= r.minSendMinor &&
      (r.maxSendMinor === null || ctx.sendAmountMinor <= r.maxSendMinor),
  );
  if (matches.length === 0) return null;
  // Highest priority; tie-break: method-specific beats generic, then id for determinism.
  matches.sort(
    (a, b) =>
      b.priority - a.priority ||
      Number(b.payoutMethod != null) - Number(a.payoutMethod != null) ||
      a.id.localeCompare(b.id),
  );
  return matches[0]!;
}

export function calculateFee(rule: FeeRule, sendAmountMinor: bigint): bigint {
  if (rule.percentageBps < 0) throw new MoneyError('Fee percentage cannot be negative');
  let fee = rule.fixedFeeMinor + divRoundHalfUp(sendAmountMinor * BigInt(rule.percentageBps), 10_000n);
  if (rule.minFeeMinor != null && fee < rule.minFeeMinor) fee = rule.minFeeMinor;
  if (rule.maxFeeMinor != null && fee > rule.maxFeeMinor) fee = rule.maxFeeMinor;
  return fee;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export interface CorridorLimits {
  minSendMinor: bigint;
  maxSendMinor: bigint;
}

export interface QuoteInput {
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  destinationCountry: string;
  payoutMethod: string;
  sendAmountMinor: bigint;
  rate: ExchangeRate;
  feeRules: FeeRule[];
  limits: CorridorLimits;
  now: Date;
}

export interface Quote {
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  destinationCountry: string;
  payoutMethod: string;
  sendAmountMinor: bigint;
  feeMinor: bigint;
  totalPayableMinor: bigint;
  rate: string;
  rateKind: RateKind;
  rateSource: string;
  rateFetchedAt: string;
  recipientAmountMinor: bigint;
  feeRuleId: string;
}

export type QuoteErrorCode =
  | 'CURRENCY_MISMATCH'
  | 'BELOW_MINIMUM'
  | 'ABOVE_MAXIMUM'
  | 'NO_FEE_RULE'
  | 'INVALID_AMOUNT';

export class QuoteError extends Error {
  constructor(public readonly code: QuoteErrorCode, message: string) {
    super(message);
    this.name = 'QuoteError';
  }
}

export function buildQuote(input: QuoteInput): Quote {
  const { rate, sendAmountMinor } = input;
  if (rate.sourceCurrency !== input.sourceCurrency || rate.destinationCurrency !== input.destinationCurrency) {
    throw new QuoteError('CURRENCY_MISMATCH', 'Exchange rate does not match the requested currency pair');
  }
  if (sendAmountMinor <= 0n) throw new QuoteError('INVALID_AMOUNT', 'Amount must be greater than zero');
  if (sendAmountMinor < input.limits.minSendMinor) {
    throw new QuoteError('BELOW_MINIMUM', 'Amount is below the minimum for this corridor');
  }
  if (sendAmountMinor > input.limits.maxSendMinor) {
    throw new QuoteError('ABOVE_MAXIMUM', 'Amount is above the maximum for this corridor');
  }
  const rule = selectFeeRule(input.feeRules, {
    sourceCurrency: input.sourceCurrency,
    destinationCountry: input.destinationCountry,
    payoutMethod: input.payoutMethod,
    sendAmountMinor,
  });
  if (!rule) throw new QuoteError('NO_FEE_RULE', 'No fee rule is configured for this transfer');

  const feeMinor = calculateFee(rule, sendAmountMinor);
  return {
    sourceCurrency: input.sourceCurrency,
    destinationCurrency: input.destinationCurrency,
    destinationCountry: input.destinationCountry,
    payoutMethod: input.payoutMethod,
    sendAmountMinor,
    feeMinor,
    totalPayableMinor: sendAmountMinor + feeMinor,
    rate: rate.rate,
    rateKind: effectiveRateKind(rate, input.now),
    rateSource: rate.source,
    rateFetchedAt: rate.fetchedAt,
    recipientAmountMinor: convert(sendAmountMinor, input.sourceCurrency, input.destinationCurrency, rate.rate),
    feeRuleId: rule.id,
  };
}

/**
 * A quote can only be locked (confirmed) on a LIVE or SANDBOX rate. ESTIMATED rates
 * are informational and cannot back a transfer.
 */
export function canLockQuote(q: Pick<Quote, 'rateKind'>, environment: 'production' | 'non-production'): boolean {
  if (q.rateKind === 'LIVE') return true;
  if (q.rateKind === 'SANDBOX') return environment === 'non-production';
  return false;
}
