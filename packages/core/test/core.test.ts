import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, toDecimalString, formatMoney, divRoundHalfUp, MoneyError,
  convert, parseRate, buildQuote, calculateFee, selectFeeRule, QuoteError, canLockQuote, effectiveRateKind,
  type ExchangeRate,
  canTransition, assertTransition, InvalidTransitionError, TRANSITIONS, TRANSFER_STATUSES, FUNDS_COLLECTED_STATUSES,
  paymentReceivedJournal, payoutCompletedJournal, refundCompletedJournal, reversalJournal, assertBalanced, accountBalance, accounts, LedgerError,
  generateReference, isValidReference, normaliseReference,
  normaliseMsisdn, validateMobileMoneyNumber, validateRecipientName, maskMsisdn, payoutLimitError,
  COUNTRIES, CORRIDORS, DEFAULT_FEE_RULES,
} from '../src/index.js';

const ZM = COUNTRIES.find((c) => c.code === 'ZM')!;
const GBZM = CORRIDORS[0]!;
const now = new Date('2026-11-24T12:00:00Z');
const sandboxRate: ExchangeRate = {
  sourceCurrency: 'GBP', destinationCurrency: 'ZMW', rate: '33.85000000',
  kind: 'SANDBOX', source: 'sandbox-config', fetchedAt: now.toISOString(),
};

describe('money', () => {
  test('parses and formats without floating point', () => {
    assert.equal(parseAmount('100.5', 2), 10050n);
    assert.equal(parseAmount('0.01', 2), 1n);
    assert.equal(parseAmount('10.500', 2), 1050n);
    assert.equal(toDecimalString(10050n, 2), '100.50');
    assert.equal(toDecimalString(5n, 2), '0.05');
    assert.equal(toDecimalString(-5n, 2), '-0.05');
    assert.equal(formatMoney(123456789n, 'GBP'), '£1,234,567.89');
    assert.equal(formatMoney(0n, 'ZMW'), 'K0.00');
  });
  test('rejects bad input', () => {
    for (const bad of ['', '-1', '1e3', '1.234', 'abc', '1,000', '.5']) {
      assert.throws(() => parseAmount(bad, 2), MoneyError, bad);
    }
  });
  test('classic float trap is exact', () => {
    assert.equal(parseAmount('0.1', 2) + parseAmount('0.2', 2), parseAmount('0.3', 2));
  });
  test('half-up rounding', () => {
    assert.equal(divRoundHalfUp(15n, 10n), 2n);
    assert.equal(divRoundHalfUp(14n, 10n), 1n);
    assert.equal(divRoundHalfUp(-15n, 10n), -2n);
  });
});

describe('fx + fees + quote', () => {
  test('conversion rounds down', () => {
    assert.equal(convert(10000n, 'GBP', 'ZMW', '33.85'), 338500n); // £100 -> K3,385.00
    assert.equal(convert(1n, 'GBP', 'ZMW', '33.857'), 33n); // 0.33857 -> 0.33
    assert.equal(convert(333n, 'GBP', 'ZMW', '1.005'), 334n); // 3.34665 -> 3.34
  });
  test('rate parsing', () => {
    assert.equal(parseRate('1'), 100000000n);
    assert.throws(() => parseRate('0'));
    assert.throws(() => parseRate('1.123456789'));
  });
  test('fee rule selection by band', () => {
    const ctx = { sourceCurrency: 'GBP', destinationCountry: 'ZM', payoutMethod: 'MOBILE_MONEY' };
    assert.equal(selectFeeRule(DEFAULT_FEE_RULES, { ...ctx, sendAmountMinor: 5000n })!.id, 'gb-zm-mm-small');
    assert.equal(selectFeeRule(DEFAULT_FEE_RULES, { ...ctx, sendAmountMinor: 9999n })!.id, 'gb-zm-mm-small');
    assert.equal(selectFeeRule(DEFAULT_FEE_RULES, { ...ctx, sendAmountMinor: 10000n })!.id, 'gb-zm-mm-standard');
    assert.equal(selectFeeRule(DEFAULT_FEE_RULES, { ...ctx, sendAmountMinor: 10000n, payoutMethod: 'BANK_ACCOUNT' }), null);
  });
  test('fee calculation with cap', () => {
    const std = DEFAULT_FEE_RULES[1]!;
    assert.equal(calculateFee(std, 10000n), 199n); // 0.99 + 1% of 100
    assert.equal(calculateFee(std, 25050n), 350n); // 0.99 + 2.505 -> 2.51 => 3.50
    assert.equal(calculateFee(std, 200000n), 1999n); // capped
  });
  test('full quote', () => {
    const q = buildQuote({
      sourceCurrency: 'GBP', destinationCurrency: 'ZMW', destinationCountry: 'ZM', payoutMethod: 'MOBILE_MONEY',
      sendAmountMinor: 25000n, rate: sandboxRate, feeRules: DEFAULT_FEE_RULES, limits: GBZM, now,
    });
    assert.equal(q.feeMinor, 349n);
    assert.equal(q.totalPayableMinor, 25349n);
    assert.equal(q.recipientAmountMinor, 846250n);
    assert.equal(q.rateKind, 'SANDBOX');
  });
  test('limits enforced', () => {
    const base = { sourceCurrency: 'GBP', destinationCurrency: 'ZMW', destinationCountry: 'ZM', payoutMethod: 'MOBILE_MONEY', rate: sandboxRate, feeRules: DEFAULT_FEE_RULES, limits: GBZM, now };
    assert.throws(() => buildQuote({ ...base, sendAmountMinor: 999n }), (e: unknown) => e instanceof QuoteError && e.code === 'BELOW_MINIMUM');
    assert.throws(() => buildQuote({ ...base, sendAmountMinor: 200001n }), (e: unknown) => e instanceof QuoteError && e.code === 'ABOVE_MAXIMUM');
    assert.throws(() => buildQuote({ ...base, sendAmountMinor: 5000n, destinationCurrency: 'USD' }), (e: unknown) => e instanceof QuoteError && e.code === 'CURRENCY_MISMATCH');
  });
  test('expired LIVE rate is only an estimate and cannot be locked', () => {
    const live: ExchangeRate = { ...sandboxRate, kind: 'LIVE', validUntil: '2026-11-24T11:59:00Z' };
    assert.equal(effectiveRateKind(live, now), 'ESTIMATED');
    assert.equal(canLockQuote({ rateKind: 'ESTIMATED' }, 'non-production'), false);
    assert.equal(canLockQuote({ rateKind: 'LIVE' }, 'production'), true);
  });
  test('sandbox rates can never back a production quote', () => {
    assert.equal(canLockQuote({ rateKind: 'SANDBOX' }, 'production'), false);
    assert.equal(canLockQuote({ rateKind: 'SANDBOX' }, 'non-production'), true);
  });
});

describe('transfer state machine', () => {
  test('happy path', () => {
    const path = ['DRAFT', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_RECEIVED', 'PAYOUT_PROCESSING', 'COMPLETED'] as const;
    for (let i = 0; i < path.length - 1; i++) assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]}->${path[i + 1]}`);
  });
  test('collected funds can never fail or be cancelled — only complete or refund', () => {
    for (const s of FUNDS_COLLECTED_STATUSES) {
      assert.equal(canTransition(s, 'FAILED'), false, s);
      assert.equal(canTransition(s, 'CANCELLED'), false, s);
    }
  });
  test('terminal states have no exits', () => {
    for (const s of ['COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'] as const) assert.equal(TRANSITIONS[s].length, 0);
  });
  test('invalid transition throws', () => {
    assert.throws(() => assertTransition('COMPLETED', 'REFUNDED'), InvalidTransitionError);
    assert.throws(() => assertTransition('DRAFT', 'COMPLETED'), InvalidTransitionError);
  });
  test('every status is reachable from DRAFT', () => {
    const seen = new Set<string>(['DRAFT']);
    const queue: string[] = ['DRAFT'];
    while (queue.length) for (const n of TRANSITIONS[queue.shift() as keyof typeof TRANSITIONS]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    assert.deepEqual([...seen].sort(), [...TRANSFER_STATUSES].sort());
  });
});

describe('ledger', () => {
  const t = {
    reference: 'EBK-TEST', sourceCurrency: 'GBP', destinationCurrency: 'ZMW',
    sendAmountMinor: 25000n, feeMinor: 349n, recipientAmountMinor: 846250n,
    collectionProvider: 'SANDBOX_COLLECT', payoutProvider: 'MTN_MOMO',
  };
  test('journals balance per currency', () => {
    for (const j of [paymentReceivedJournal(t), payoutCompletedJournal(t), refundCompletedJournal(t, true), refundCompletedJournal(t, false)]) {
      assert.doesNotThrow(() => assertBalanced(j.lines));
    }
  });
  test('completed transfer clears customer liability; fee stays as revenue', () => {
    const lines = [...paymentReceivedJournal(t).lines, ...payoutCompletedJournal(t).lines];
    assert.equal(accountBalance(lines, accounts.customerTransfers('GBP')), 0n);
    assert.equal(accountBalance(lines, accounts.feeRevenue('GBP')), -349n);
    assert.equal(accountBalance(lines, accounts.payoutFunding('MTN_MOMO', 'ZMW')), -846250n);
  });
  test('refund without fee refund keeps fee revenue', () => {
    const lines = [...paymentReceivedJournal(t).lines, ...refundCompletedJournal(t, false).lines];
    assert.equal(accountBalance(lines, accounts.customerTransfers('GBP')), 0n);
    assert.equal(accountBalance(lines, accounts.collectionClearing('SANDBOX_COLLECT', 'GBP')), 349n);
  });
  test('reversal nets to zero', () => {
    const j = paymentReceivedJournal(t);
    const all = [...j.lines, ...reversalJournal(j).lines];
    for (const l of j.lines) assert.equal(accountBalance(all, l.account), 0n);
  });
  test('unbalanced or non-positive lines rejected', () => {
    assert.throws(() => assertBalanced([
      { account: 'A', side: 'DEBIT', amountMinor: 10n, currency: 'GBP' },
      { account: 'B', side: 'CREDIT', amountMinor: 9n, currency: 'GBP' },
    ]), LedgerError);
    assert.throws(() => assertBalanced([
      { account: 'A', side: 'DEBIT', amountMinor: 10n, currency: 'GBP' },
      { account: 'B', side: 'CREDIT', amountMinor: 10n, currency: 'ZMW' },
    ]), LedgerError);
    assert.throws(() => assertBalanced([
      { account: 'A', side: 'DEBIT', amountMinor: -10n, currency: 'GBP' },
      { account: 'B', side: 'CREDIT', amountMinor: -10n, currency: 'GBP' },
    ]), LedgerError);
  });
});

describe('references', () => {
  test('format, check digit and uniqueness', () => {
    const set = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const r = generateReference();
      assert.ok(isValidReference(r), r);
      set.add(r);
    }
    assert.equal(set.size, 5000);
  });
  test('single-character typo is detected', () => {
    const r = generateReference('EBK', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    const swapped = r.slice(0, 4) + (r[4] === 'A' ? 'B' : 'A') + r.slice(5);
    assert.equal(isValidReference(swapped), false);
  });
  test('normalises lowercase and ambiguous characters', () => {
    assert.equal(normaliseReference(' ebk-o1il '), 'EBK-0111');
  });
});

describe('beneficiaries', () => {
  const phone = ZM.phone;
  const ops = ZM.mobileOperators;
  test('normalises Zambian formats', () => {
    for (const v of ['0961234567', '+260961234567', '260 96 123 4567', '00260961234567', '961234567']) {
      assert.equal(normaliseMsisdn(v, phone).msisdn, '260961234567', v);
    }
    assert.equal(normaliseMsisdn('09612345', phone).ok, false);
    assert.equal(normaliseMsisdn('09612x4567', phone).ok, false);
  });
  test('operator must match number prefix', () => {
    assert.equal(validateMobileMoneyNumber('0961234567', 'MTN_ZM', phone, ops).ok, true);
    assert.equal(validateMobileMoneyNumber('0771234567', 'AIRTEL_ZM', phone, ops).ok, true);
    const wrong = validateMobileMoneyNumber('0971234567', 'MTN_ZM', phone, ops);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.detectedOperator, 'AIRTEL_ZM');
    assert.equal(validateMobileMoneyNumber('0951234567', 'ZAMTEL_ZM', phone, ops).ok, false); // inactive
  });
  test('recipient names', () => {
    assert.equal(validateRecipientName('Mwila Banda'), null);
    assert.equal(validateRecipientName("Chanda O'Neil-Phiri"), null);
    assert.notEqual(validateRecipientName('Mwila'), null);
    assert.notEqual(validateRecipientName('<script> x'), null);
  });
  test('network payout limits', () => {
    const mtn = ZM.mobileOperators.find((o) => o.code === 'MTN_ZM')!;
    const fmt = (m: bigint) => formatMoney(m, 'ZMW');
    assert.equal(payoutLimitError(1_000_000n, mtn, fmt), null); // exactly K10,000 allowed
    assert.match(payoutLimitError(1_000_001n, mtn, fmt)!, /MTN MoMo accepts up to K10,000.00/);
    assert.equal(payoutLimitError(99_999_999n, { name: 'X', maxPayoutMinor: null }, fmt), null);
  });
  test('masking', () => {
    assert.equal(maskMsisdn('260961234567', '260'), '+260 96 *** 4567');
  });
});
