import { currencyInfo, formatMoney, parseAmount } from '@ebk/core';
import type { Money } from './types';

/** Format an API Money DTO without ever converting to a JS float. */
export function formatMoneyDto(m: Money): string {
  return formatMoney(parseAmount(m.amount, currencyInfo(m.currency).minorUnits), m.currency);
}

export function formatRate(rate: string, from: string, to: string): string {
  const [w, f = ''] = rate.split('.');
  const trimmed = f.replace(/0+$/, '').padEnd(2, '0').slice(0, 4);
  return `1 ${from} = ${w}.${trimmed} ${to}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => `${dateFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))}`;

export function relativeDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (diff === 0) return `Today, ${timeFmt.format(d)}`;
  if (diff === 1) return `Yesterday, ${timeFmt.format(d)}`;
  return formatDate(iso);
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
