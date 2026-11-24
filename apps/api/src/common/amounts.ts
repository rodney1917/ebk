/**
 * Conversion between database NUMERIC values (Prisma Decimal / strings) and
 * @ebk/core minor-unit BigInts. No floating point anywhere on this path.
 */
import { currencyInfo, parseAmount, toDecimalString } from '@ebk/core';

/** Anything with a decimal toString(): Prisma.Decimal, string, bigint-free numerics. */
type DecimalLike = { toString(): string } | string;

/** DB NUMERIC -> minor units. Accepts "100.5", "100.5000", Prisma Decimal. */
export function dbToMinor(value: DecimalLike, currency: string): bigint {
  const s = typeof value === 'string' ? value : value.toString();
  if (/e/i.test(s)) throw new Error(`Unexpected exponent notation in amount: ${s}`);
  return parseAmount(s, currencyInfo(currency).minorUnits);
}

/** Minor units -> decimal string suitable for a NUMERIC column. */
export function minorToDb(minor: bigint, currency: string): string {
  return toDecimalString(minor, currencyInfo(currency).minorUnits);
}

/** Public API representation of an amount. Always a string — never a JS number. */
export interface MoneyDto {
  amount: string;
  currency: string;
}

export function money(minor: bigint, currency: string): MoneyDto {
  return { amount: minorToDb(minor, currency), currency };
}

/** Normalise a DB rate to a fixed 8dp string. */
export function rateToString(value: DecimalLike): string {
  const s = typeof value === 'string' ? value : value.toString();
  const [w, f = ''] = s.split('.');
  return `${w}.${(f + '00000000').slice(0, 8)}`;
}
