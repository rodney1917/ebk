import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  FieldCipher, hashPassword, needsRehash, passwordPolicyError, requestHash, safeEqual, sha256, stableStringify, verifyPassword, DUMMY_PASSWORD_HASH,
} from '../../src/common/crypto';
import { dbToMinor, minorToDb, money, rateToString } from '../../src/common/amounts';
import { signSandboxPayload, verifySandboxSignature } from '../../src/providers/sandbox/sandbox-signing';
import { SandboxCollectionAdapter, SandboxPayoutAdapter } from '../../src/providers/sandbox/sandbox.adapters';
import { idempotencyKeyToUuid, MtnMomoDisbursementAdapter } from '../../src/providers/mtn-momo/mtn-momo-disbursement.adapter';
import { loadEnv } from '../../src/config/env';

const baseEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/ebk',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

describe('passwords', () => {
  test('hash + verify', async () => {
    const h = await hashPassword('correct horse battery staple');
    assert.match(h, /^scrypt\$32768\$8\$1\$/);
    assert.equal(await verifyPassword('correct horse battery staple', h), true);
    assert.equal(await verifyPassword('wrong password here', h), false);
    assert.equal(needsRehash(h), false);
    assert.equal(await verifyPassword('anything', DUMMY_PASSWORD_HASH), false);
    assert.equal(await verifyPassword('x', 'garbage'), false);
  });
  test('policy', () => {
    assert.notEqual(passwordPolicyError('short'), null);
    assert.notEqual(passwordPolicyError('aaaaaaaaaaaaaa'), null);
    assert.notEqual(passwordPolicyError('mwilabanda-2026!', 'mwilabanda@x.com'), null);
    assert.equal(passwordPolicyError('a long enough passphrase'), null);
  });
});

describe('field encryption', () => {
  const c = new FieldCipher(randomBytes(32).toString('base64'));
  test('round trip, random IV', () => {
    const a = c.encrypt('1234567890');
    assert.notEqual(a, c.encrypt('1234567890'));
    assert.equal(c.decrypt(a), '1234567890');
  });
  test('tampering and wrong AAD are detected', () => {
    const a = c.encrypt('secret', 'bank_account');
    const parts = a.split(':');
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0] = ct[0]! ^ 1;
    assert.throws(() => c.decrypt([parts[0], parts[1], parts[2], ct.toString('base64')].join(':'), 'bank_account'));
    assert.throws(() => c.decrypt(a, 'other'));
  });
  test('rejects bad keys', () => assert.throws(() => new FieldCipher(randomBytes(16).toString('base64'))));
});

describe('amount conversion', () => {
  test('db <-> minor', () => {
    assert.equal(dbToMinor('100.5', 'GBP'), 10050n);
    assert.equal(dbToMinor('100.5000', 'GBP'), 10050n);
    assert.equal(dbToMinor({ toString: () => '8462.5' }, 'ZMW'), 846250n);
    assert.throws(() => dbToMinor('1e3', 'GBP'));
    assert.throws(() => dbToMinor('1.234', 'GBP'));
    assert.equal(minorToDb(5n, 'GBP'), '0.05');
    assert.deepEqual(money(25349n, 'GBP'), { amount: '253.49', currency: 'GBP' });
    assert.equal(rateToString('33.85'), '33.85000000');
  });
});

describe('idempotency hashing', () => {
  test('key order does not matter, values do', () => {
    assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
    assert.equal(requestHash('post', '/t', { a: 1, b: 2 }), requestHash('POST', '/t', { b: 2, a: 1 }));
    assert.notEqual(requestHash('POST', '/t', { a: 1 }), requestHash('POST', '/t', { a: 2 }));
  });
  test('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('sandbox webhook signatures', () => {
  const secret = 'sandbox-secret-123456';
  const body = Buffer.from('{"id":"evt_1"}');
  test('valid signature verifies', () => {
    assert.equal(verifySandboxSignature(secret, signSandboxPayload(secret, body), body), true);
  });
  test('tampered body, wrong secret, missing header, replay all rejected', () => {
    const sig = signSandboxPayload(secret, body);
    assert.equal(verifySandboxSignature(secret, sig, Buffer.from('{"id":"evt_2"}')), false);
    assert.equal(verifySandboxSignature('another-secret-xyz', sig, body), false);
    assert.equal(verifySandboxSignature(secret, undefined, body), false);
    const old = signSandboxPayload(secret, body, Math.floor(Date.now() / 1000) - 3600);
    assert.equal(verifySandboxSignature(secret, old, body), false);
  });
});

describe('sandbox adapters', () => {
  test('refuse to exist in production', () => {
    assert.throws(() => new SandboxCollectionAdapter({ nodeEnv: 'production', webhookSecret: 'x'.repeat(16), checkoutBaseUrl: 'http://x' }));
    assert.throws(() => new SandboxPayoutAdapter({ nodeEnv: 'production' }));
  });
  test('payout outcomes are deterministic by number', async () => {
    const a = new SandboxPayoutAdapter({ nodeEnv: 'test', settleAfterMs: 0 });
    const req = (key: string, msisdn: string) => ({ idempotencyKey: key, transferReference: 'R', amountMinor: 100n, currency: 'ZMW', recipient: { fullName: 'A B', msisdn }, narration: 'n', callbackUrl: 'http://x' });
    await a.initiatePayout(req('k1', '260961234567'));
    await a.initiatePayout(req('k2', '260960000000'));
    await a.initiatePayout(req('k3', '260969999999'));
    assert.equal((await a.getPayoutStatus('k1')).status, 'SUCCEEDED');
    assert.equal((await a.getPayoutStatus('k2')).failureCode, 'PAYEE_NOT_FOUND');
    assert.equal((await a.getPayoutStatus('k3')).status, 'PENDING');
    assert.equal((await a.getPayoutStatus('unknown')).status, 'UNKNOWN');
    const dup = await a.initiatePayout(req('k1', '260961234567'));
    assert.equal((dup.raw as { duplicate: boolean }).duplicate, true);
  });
  test('collection webhook round trip through adapter', async () => {
    const secret = 'sandbox-secret-123456';
    const a = new SandboxCollectionAdapter({ nodeEnv: 'test', webhookSecret: secret, checkoutBaseUrl: 'http://api/sandbox/checkout' });
    const init = await a.initiateCollection({ idempotencyKey: 'EBK-AAAA-BBBB-CCD:collect:1', transferReference: 'EBK-AAAA-BBBB-CCD', amountMinor: 25349n, currency: 'GBP', customer: { id: '1', email: 'e', name: 'n' }, returnUrl: 'r', callbackUrl: 'c' });
    assert.equal(init.status, 'PENDING');
    assert.match(init.checkoutUrl!, /^http:\/\/api\/sandbox\/checkout\/EBK-AAAA-BBBB-CCD%3Acollect%3A1$/);
    const raw = Buffer.from(JSON.stringify({ id: 'evt_9', type: 'collection.succeeded', data: { idempotencyKey: 'k', providerReference: 'p', amountMinor: '25349', currency: 'GBP' } }));
    const input = { headers: { 'x-ebk-sandbox-signature': signSandboxPayload(secret, raw) }, rawBody: raw };
    assert.equal(a.verifyWebhook(input), true);
    const ev = a.parseWebhook(input);
    assert.equal(ev.status, 'SUCCEEDED');
    assert.equal(ev.amountMinor, 25349n);
  });
});

describe('MTN MoMo adapter (mocked HTTP)', () => {
  test('reference ids are stable UUIDv4', () => {
    const u = idempotencyKeyToUuid('EBK-X:payout:1', sha256);
    assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(u, idempotencyKeyToUuid('EBK-X:payout:1', sha256));
    assert.notEqual(u, idempotencyKeyToUuid('EBK-X:payout:2', sha256));
  });
  test('transfer + status calls use the documented headers and map statuses; 5xx is UNKNOWN', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let transferStatus = 202;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/disbursement/token/')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      if (url.endsWith('/disbursement/v1_0/transfer')) return new Response('', { status: transferStatus });
      return new Response(JSON.stringify({ status: 'SUCCESSFUL', financialTransactionId: '123' }), { status: 200 });
    }) as unknown as typeof fetch;
    const a = new MtnMomoDisbursementAdapter(
      { baseUrl: 'https://sandbox.momodeveloper.mtn.com', targetEnvironment: 'sandbox', subscriptionKey: 'sub', apiUser: 'user', apiKey: 'key', sandboxCurrencyOverride: 'EUR', fetchImpl },
      sha256,
    );
    const req = { idempotencyKey: 'EBK-X:payout:1', transferReference: 'EBK-X', amountMinor: 846250n, currency: 'ZMW', recipient: { fullName: 'A B', msisdn: '260961234567' }, narration: 'n', callbackUrl: 'https://api/cb' };
    const r = await a.initiatePayout(req);
    assert.equal(r.status, 'PENDING');
    const t = calls.find((c) => c.url.endsWith('/transfer'))!;
    const h = t.init.headers as Record<string, string>;
    assert.equal(h['X-Target-Environment'], 'sandbox');
    assert.equal(h['Authorization'], 'Bearer tok');
    assert.equal(h['X-Reference-Id'], r.providerReference);
    assert.deepEqual(JSON.parse(String(t.init.body)).amount, '8462.50');
    assert.equal(JSON.parse(String(t.init.body)).currency, 'EUR');
    assert.equal((await a.getPayoutStatus(req.idempotencyKey, r.providerReference)).status, 'SUCCEEDED');
    transferStatus = 500;
    assert.equal((await a.initiatePayout({ ...req, idempotencyKey: 'EBK-X:payout:2' })).status, 'UNKNOWN');
    transferStatus = 400;
    assert.equal((await a.initiatePayout({ ...req, idempotencyKey: 'EBK-X:payout:3' })).status, 'FAILED');
    assert.equal(calls.filter((c) => c.url.endsWith('/token/')).length, 1, 'token is cached');
  });
  test('missing credentials -> not configured', async () => {
    const a = new MtnMomoDisbursementAdapter({ baseUrl: 'https://x', targetEnvironment: 'sandbox' }, sha256);
    await assert.rejects(() => a.initiatePayout({ idempotencyKey: 'k', transferReference: 'r', amountMinor: 1n, currency: 'ZMW', recipient: { fullName: 'a', msisdn: '1' }, narration: '', callbackUrl: '' }), /not configured/);
  });
});

describe('environment safety', () => {
  test('valid development config loads', () => {
    assert.equal(loadEnv({ ...baseEnv }).NODE_ENV, 'development');
  });
  test('sandbox providers can never be enabled in production', () => {
    assert.throws(() => loadEnv({ ...baseEnv, NODE_ENV: 'production', SANDBOX_PROVIDERS_ENABLED: 'true', SANDBOX_WEBHOOK_SECRET: 'x'.repeat(20), MTN_MOMO_TARGET_ENVIRONMENT: 'mtnzambia' }), /never be enabled in production/);
  });
  test('production cannot target the MTN sandbox', () => {
    assert.throws(() => loadEnv({ ...baseEnv, NODE_ENV: 'production' }), /MTN sandbox/);
  });
  test('weak secrets rejected', () => {
    assert.throws(() => loadEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'short' }), /JWT_ACCESS_SECRET/);
    assert.throws(() => loadEnv({ ...baseEnv, FIELD_ENCRYPTION_KEY: 'abc' }), /FIELD_ENCRYPTION_KEY/);
  });
});
