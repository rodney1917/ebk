/**
 * Money handling for EBK.
 *
 * All amounts are held as BigInt *minor units* (pence, ngwee). Floating point is
 * never used for money. Amounts cross API / database boundaries as decimal strings
 * (Postgres NUMERIC), and are converted with parseAmount / toDecimalString.
 */

export type CurrencyCode = string; // ISO 4217, e.g. "GBP", "ZMW"

export interface CurrencyInfo {
  code: CurrencyCode;
  minorUnits: number; // decimal places, e.g. 2
  symbol: string;
  name: string;
}

/** Default currency metadata. Additional currencies are configured in the database. */
export const CURRENCIES: Record<string, CurrencyInfo> = {
  GBP: { code: 'GBP', minorUnits: 2, symbol: '£', name: 'British pound' },
  ZMW: { code: 'ZMW', minorUnits: 2, symbol: 'K', name: 'Zambian kwacha' },
  EUR: { code: 'EUR', minorUnits: 2, symbol: '€', name: 'Euro' },
  USD: { code: 'USD', minorUnits: 2, symbol: '$', name: 'US dollar' },
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  const info = CURRENCIES[code];
  if (!info) throw new MoneyError(`Unsupported currency: ${code}`);
  return info;
}

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/**
 * Parse a non-negative decimal string into minor units.
 * Rejects more decimal places than the currency supports (no silent rounding of input).
 */
export function parseAmount(value: string, minorUnits: number): bigint {
  const v = value.trim();
  if (!DECIMAL_RE.test(v)) throw new MoneyError(`Invalid amount: "${value}"`);
  const [whole, frac = ''] = v.split('.');
  if (frac.length > minorUnits) {
    // Allow trailing zeros beyond precision ("10.500" for 2dp), reject real extra precision.
    if (/[^0]/.test(frac.slice(minorUnits))) {
      throw new MoneyError(`Amount "${value}" has more than ${minorUnits} decimal places`);
    }
  }
  const fracPadded = (frac + '0'.repeat(minorUnits)).slice(0, minorUnits);
  return BigInt(whole! + fracPadded);
}

/** Convert minor units to a plain decimal string, e.g. 10050n,2 -> "100.50". */
export function toDecimalString(minor: bigint, minorUnits: number): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  if (minorUnits === 0) return (neg ? '-' : '') + abs.toString();
  const s = abs.toString().padStart(minorUnits + 1, '0');
  const whole = s.slice(0, s.length - minorUnits);
  const frac = s.slice(s.length - minorUnits);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Display formatting, e.g. "£1,250.00". Uses grouping without floating point. */
export function formatMoney(minor: bigint, currency: CurrencyCode): string {
  const info = currencyInfo(currency);
  const dec = toDecimalString(minor, info.minorUnits);
  const neg = dec.startsWith('-');
  const [whole, frac] = (neg ? dec.slice(1) : dec).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${info.symbol}${grouped}${frac ? '.' + frac : ''}`;
}

/** Integer division rounding half away from zero (for non-negative values: half-up). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new MoneyError('Denominator must be positive');
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= denominator) return numerator < 0n ? q - 1n : q + 1n;
  return q;
}

/** Integer division rounding toward negative infinity (floor). */
export function divFloor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new MoneyError('Denominator must be positive');
  const q = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n ? q - 1n : q;
}
