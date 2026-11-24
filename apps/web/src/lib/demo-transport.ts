/**
 * ===================== DEMO / PREVIEW ONLY =====================
 * In-memory stand-in for the EBK API so the UI can be reviewed without a backend.
 * Compiled in only when __EBK_DEMO__ is true, which vite.config.ts forbids for
 * production builds. Uses the same @ebk/core quote logic as the API. Rates are
 * SANDBOX, nothing is sent anywhere, and the UI shows a permanent "Demo" banner.
 * ===============================================================
 */
import {
  buildQuote, CORRIDORS, COUNTRIES, DEFAULT_FEE_RULES, generateReference, maskMsisdn, parseAmount, QuoteError, STATUS_LABELS,
  toDecimalString, validateMobileMoneyNumber, validateRecipientName, type ExchangeRate, type TransferStatus,
} from '@ebk/core';
import { ApiError, type Transport } from './api';
import type { Beneficiary, BeneficiaryInput, Corridor, Me, QuoteDto, ReceiptDto, TransferDto } from './types';

const ZM = COUNTRIES.find((c) => c.code === 'ZM')!;
const corridor = CORRIDORS[0]!;
const rate = (): ExchangeRate => ({
  sourceCurrency: 'GBP', destinationCurrency: 'ZMW', rate: '33.85000000', kind: 'SANDBOX', source: 'demo:sandbox-reference', fetchedAt: new Date().toISOString(),
});
const money = (minor: bigint, currency: string) => ({ amount: toDecimalString(minor, 2), currency });
const uuid = () => crypto.randomUUID();
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

interface DemoTransfer extends TransferDto {
  quoteId: string;
  advanceAt?: number;
}

export class DemoTransport implements Transport {
  private signedIn = true;
  private me: Me = {
    id: 'demo-user', email: 'demo.sender@ebk.test', phone: '+447700900123', emailVerified: true, phoneVerified: false, mfaEnabled: false, status: 'ACTIVE',
    profile: { firstName: 'Natasha', lastName: 'Mulenga', countryOfResidence: 'GB', kycStatus: 'VERIFIED' },
  };
  private beneficiaries: Beneficiary[] = [];
  private quotes = new Map<string, QuoteDto>();
  private transfers: DemoTransfer[] = [];
  private idem = new Map<string, unknown>();

  constructor() {
    const mk = (fullName: string, op: 'MTN_ZM' | 'AIRTEL_ZM', number: string, nickname: string | null, ago: number): Beneficiary => ({
      id: uuid(), fullName, nickname, countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY',
      mobileOperator: { code: op, name: op === 'MTN_ZM' ? 'MTN MoMo' : 'Airtel Money' },
      mobileNumber: `+${number}`, mobileNumberMasked: maskMsisdn(number, '260'), createdAt: minutesAgo(ago),
    });
    this.beneficiaries = [
      mk('Grace Mulenga', 'MTN_ZM', '260961234567', 'Mum', 60 * 24 * 40),
      mk('Joseph Banda', 'AIRTEL_ZM', '260971112233', null, 60 * 24 * 12),
      mk('Mercy Phiri', 'MTN_ZM', '260764455667', 'Sister', 60 * 24 * 3),
    ];
    const seed: [number, string, TransferStatus, number][] = [
      [0, '150.00', 'PAYOUT_PROCESSING', 18],
      [1, '80.00', 'COMPLETED', 60 * 26],
      [0, '250.00', 'COMPLETED', 60 * 24 * 9],
      [2, '40.00', 'FAILED', 60 * 24 * 15],
      [0, '200.00', 'COMPLETED', 60 * 24 * 32],
    ];
    for (const [b, amt, status, ago] of seed) this.transfers.push(this.makeTransfer(this.beneficiaries[b]!, amt, status, minutesAgo(ago)));
  }

  private makeTransfer(b: Beneficiary, amount: string, status: TransferStatus, createdAt: string): DemoTransfer {
    const q = buildQuote({
      sourceCurrency: 'GBP', destinationCurrency: 'ZMW', destinationCountry: 'ZM', payoutMethod: 'MOBILE_MONEY',
      sendAmountMinor: parseAmount(amount, 2), rate: rate(), feeRules: DEFAULT_FEE_RULES, limits: corridor, now: new Date(),
    });
    const path: TransferStatus[] = status === 'FAILED' ? ['DRAFT', 'PENDING_PAYMENT', 'FAILED']
      : ['DRAFT', 'PENDING_PAYMENT', 'PAYMENT_RECEIVED', 'PAYOUT_PROCESSING', ...(status === 'COMPLETED' ? ['COMPLETED' as const] : [])];
    const t0 = new Date(createdAt).getTime();
    return {
      id: uuid(), quoteId: uuid(), reference: generateReference(), status,
      statusLabel: STATUS_LABELS[status].label, statusTone: STATUS_LABELS[status].tone,
      sendAmount: money(q.sendAmountMinor, 'GBP'), fee: money(q.feeMinor, 'GBP'), totalPayable: money(q.totalPayableMinor, 'GBP'),
      recipientAmount: money(q.recipientAmountMinor, 'ZMW'), exchangeRate: { value: q.rate, kind: 'SANDBOX' }, payoutMethod: 'MOBILE_MONEY',
      recipient: { fullName: b.fullName, network: b.mobileOperator?.name ?? null, accountMasked: b.mobileNumberMasked, country: 'ZM' },
      createdAt, updatedAt: createdAt, completedAt: status === 'COMPLETED' ? new Date(t0 + 4 * 60_000).toISOString() : null,
      timeline: path.map((s, i) => ({ status: s, label: STATUS_LABELS[s].label, at: new Date(t0 + i * 60_000).toISOString() })),
      payment: null,
    };
  }

  private advance(t: DemoTransfer) {
    const next: Partial<Record<TransferStatus, TransferStatus>> = { PENDING_PAYMENT: 'PAYMENT_RECEIVED', PAYMENT_RECEIVED: 'PAYOUT_PROCESSING', PAYOUT_PROCESSING: 'COMPLETED' };
    while (t.advanceAt && Date.now() >= t.advanceAt && next[t.status]) {
      const s = next[t.status]!;
      t.status = s;
      t.statusLabel = STATUS_LABELS[s].label;
      t.statusTone = STATUS_LABELS[s].tone;
      t.timeline.push({ status: s, label: STATUS_LABELS[s].label, at: new Date().toISOString() });
      t.updatedAt = new Date().toISOString();
      if (s === 'COMPLETED') { t.completedAt = t.updatedAt; t.advanceAt = undefined; } else t.advanceAt += 2500;
    }
  }

  private dto(t: DemoTransfer): TransferDto {
    this.advance(t);
    const { quoteId: _q, advanceAt: _a, ...rest } = t;
    return structuredClone(rest);
  }

  private quote(body: { sendAmount: string; payoutMethod: string }, lock: boolean): QuoteDto {
    try {
      const q = buildQuote({
        sourceCurrency: 'GBP', destinationCurrency: 'ZMW', destinationCountry: 'ZM', payoutMethod: body.payoutMethod,
        sendAmountMinor: parseAmount(body.sendAmount || '0', 2), rate: rate(), feeRules: DEFAULT_FEE_RULES, limits: corridor, now: new Date(),
      });
      const dto: QuoteDto = {
        id: lock ? uuid() : null, locked: lock, expiresAt: lock ? new Date(Date.now() + corridor.quoteLockSeconds * 1000).toISOString() : null,
        sendAmount: money(q.sendAmountMinor, 'GBP'), fee: money(q.feeMinor, 'GBP'), totalPayable: money(q.totalPayableMinor, 'GBP'),
        recipientAmount: money(q.recipientAmountMinor, 'ZMW'),
        rate: { value: q.rate, kind: q.rateKind, source: q.rateSource, fetchedAt: q.rateFetchedAt }, payoutMethod: q.payoutMethod,
      };
      if (dto.id) this.quotes.set(dto.id, dto);
      return dto;
    } catch (e) {
      if (e instanceof QuoteError) throw new ApiError(422, { code: e.code, message: e.code === 'BELOW_MINIMUM' ? 'The minimum transfer is £10.00' : e.code === 'ABOVE_MAXIMUM' ? 'The maximum per transfer is £2,000.00' : e.message });
      throw new ApiError(422, { code: 'INVALID_AMOUNT', message: 'Enter a valid amount' });
    }
  }

  private validateBeneficiary(b: BeneficiaryInput) {
    const nameErr = validateRecipientName(b.fullName);
    if (nameErr) throw new ApiError(422, { code: 'VALIDATION_FAILED', fields: [{ path: 'fullName', message: nameErr }] });
    const r = validateMobileMoneyNumber(b.mobileNumber, b.mobileOperatorCode, ZM.phone, ZM.mobileOperators);
    if (!r.ok) throw new ApiError(422, { code: 'VALIDATION_FAILED', fields: [{ path: 'mobileNumber', message: r.error! }], detectedOperator: r.detectedOperator });
    const op = ZM.mobileOperators.find((o) => o.code === b.mobileOperatorCode)!;
    return { msisdn: r.msisdn!, op };
  }

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    await delay();
    const b = body as Record<string, string>;
    const key = headers['Idempotency-Key'];
    if (key && this.idem.has(`${path}:${key}`)) return structuredClone(this.idem.get(`${path}:${key}`)) as T;
    const remember = <R>(r: R): R => { if (key) this.idem.set(`${path}:${key}`, r); return r; };

    if (path === '/auth/login' || path === '/auth/register') { this.signedIn = true; return { accessToken: 'demo' } as T; }
    if (path === '/auth/logout') { this.signedIn = false; return undefined as T; }
    if (!this.signedIn) throw new ApiError(401, { code: 'UNAUTHENTICATED', message: 'Sign in required' });
    if (path === '/auth/me') return structuredClone(this.me) as T;

    if (path === '/reference-data/corridors') {
      const c: Corridor = {
        id: 'GB-ZM', source: { country: 'GB', currency: 'GBP' }, destination: { country: 'ZM', currency: 'ZMW', name: 'Zambia', dialCode: '260' },
        limits: { min: '10.00', max: '2000.00' }, payoutMethods: ['MOBILE_MONEY'],
        mobileOperators: ZM.mobileOperators.filter((o) => o.active).map((o) => ({ code: o.code, name: o.name, maxPayout: o.maxPayoutMinor == null ? null : toDecimalString(o.maxPayoutMinor, 2) })),
      };
      return [c] as T;
    }
    if (path === '/quotes/estimate') return this.quote(b as never, false) as T;
    if (path === '/quotes') return this.quote(b as never, true) as T;

    if (path === '/beneficiaries' && method === 'GET') return structuredClone(this.beneficiaries) as T;
    if (path === '/beneficiaries' && method === 'POST') {
      const input = body as BeneficiaryInput;
      const { msisdn, op } = this.validateBeneficiary(input);
      if (this.beneficiaries.some((x) => x.mobileNumber === `+${msisdn}` && x.mobileOperator?.code === op.code)) {
        throw new ApiError(409, { code: 'BENEFICIARY_EXISTS', message: 'You already have a recipient with this number' });
      }
      const nb: Beneficiary = {
        id: uuid(), fullName: input.fullName.trim(), nickname: input.nickname || null, countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY',
        mobileOperator: { code: op.code, name: op.name }, mobileNumber: `+${msisdn}`, mobileNumberMasked: maskMsisdn(msisdn, '260'), createdAt: new Date().toISOString(),
      };
      this.beneficiaries.unshift(nb);
      return structuredClone(nb) as T;
    }
    const bm = /^\/beneficiaries\/([\w-]+)$/.exec(path);
    if (bm) {
      const i = this.beneficiaries.findIndex((x) => x.id === bm[1]);
      if (i < 0) throw new ApiError(404, { code: 'BENEFICIARY_NOT_FOUND', message: 'Recipient not found' });
      if (method === 'DELETE') { this.beneficiaries.splice(i, 1); return undefined as T; }
      const input = body as BeneficiaryInput;
      const { msisdn, op } = this.validateBeneficiary(input);
      this.beneficiaries[i] = { ...this.beneficiaries[i]!, fullName: input.fullName.trim(), nickname: input.nickname || null, mobileOperator: { code: op.code, name: op.name }, mobileNumber: `+${msisdn}`, mobileNumberMasked: maskMsisdn(msisdn, '260') };
      return structuredClone(this.beneficiaries[i]) as T;
    }

    if (path.startsWith('/transfers') && method === 'GET' && !/\/transfers\/[\w-]+/.test(path)) {
      const status = new URLSearchParams(path.split('?')[1]).get('status');
      const items = this.transfers.map((t) => this.dto(t)).filter((t) => !status || t.status === status);
      return { items, nextCursor: null } as T;
    }
    if (path === '/transfers' && method === 'POST') {
      const q = this.quotes.get(b.quoteId!);
      const ben = this.beneficiaries.find((x) => x.id === b.beneficiaryId);
      if (!q || !ben) throw new ApiError(404, { code: 'NOT_FOUND', message: 'Quote or recipient not found' });
      const t = this.makeTransfer(ben, q.sendAmount.amount, 'DRAFT', new Date().toISOString());
      t.timeline = [{ status: 'DRAFT', label: 'Draft', at: t.createdAt }];
      this.transfers.unshift(t);
      return remember(this.dto(t)) as T;
    }
    const tm = /^\/transfers\/([\w-]+)(?:\/(receipt|confirm|cancel))?$/.exec(path);
    if (tm) {
      const t = this.transfers.find((x) => x.id === tm[1] || x.reference === tm[1]);
      if (!t) throw new ApiError(404, { code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
      if (tm[2] === 'confirm') {
        t.status = 'PENDING_PAYMENT'; t.statusLabel = STATUS_LABELS.PENDING_PAYMENT.label; t.statusTone = STATUS_LABELS.PENDING_PAYMENT.tone;
        t.timeline.push({ status: 'PENDING_PAYMENT', label: STATUS_LABELS.PENDING_PAYMENT.label, at: new Date().toISOString() });
        t.advanceAt = Date.now() + 2000;
        return remember({ checkoutUrl: null, paymentStatus: 'PENDING', sandbox: true }) as T;
      }
      if (tm[2] === 'cancel') {
        t.status = 'CANCELLED'; t.statusLabel = 'Cancelled'; t.statusTone = 'neutral'; t.advanceAt = undefined;
        t.timeline.push({ status: 'CANCELLED', label: 'Cancelled', at: new Date().toISOString() });
        return this.dto(t) as T;
      }
      if (tm[2] === 'receipt') {
        const r: ReceiptDto = {
          ...this.dto(t),
          issuer: { name: 'EBK — Empower Bank Konnect', note: 'EBK is not a bank. Payments are processed by authorised partners.' },
          sender: { name: `${this.me.profile!.firstName} ${this.me.profile!.lastName}`, email: this.me.email },
          paymentMethod: 'Debit card (sandbox)', payoutMethodName: t.recipient.network, isSandbox: true, generatedAt: new Date().toISOString(),
        };
        return r as T;
      }
      return this.dto(t) as T;
    }
    throw new ApiError(404, { code: 'NOT_FOUND', message: `Demo API has no route for ${method} ${path}` });
  }
}
