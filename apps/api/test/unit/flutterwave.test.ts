import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FlutterwaveTransfersAdapter, flutterwaveReference } from '../../src/providers/flutterwave/flutterwave-transfers.adapter';

type Call = { url: string; init: RequestInit };

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const req = {
  idempotencyKey: 'EBK-7KQ4-M2XP-9C*:payout:1',
  transferReference: 'EBK-7KQ4-M2XP-9C*',
  amountMinor: 846250n,
  currency: 'ZMW',
  recipient: { fullName: 'Mwila Banda', msisdn: '260961234567', operatorCode: 'MTN_ZM' },
  narration: 'Money from EBK ref EBK-7KQ4-M2XP-9C*',
  callbackUrl: 'https://api.ebk.test/api/webhooks/FLUTTERWAVE_ZM',
};

const ok = (status: string, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { status: 'success', message: 'Transfer Queued Successfully', data: { id: 1864609, reference: flutterwaveReference(req.idempotencyKey), status, ...extra } },
});

describe('Flutterwave transfers adapter', () => {
  test('references are deterministic and Flutterwave-safe', () => {
    const r = flutterwaveReference(req.idempotencyKey);
    assert.match(r, /^[A-Za-z0-9_-]+$/);
    assert.equal(r, flutterwaveReference(req.idempotencyKey));
    assert.notEqual(r, flutterwaveReference('EBK-7KQ4-M2XP-9C*:payout:2'));
  });

  test('initiates a ZMW mobile money transfer with the documented body', async () => {
    const { calls, fetchImpl } = mockFetch(() => ok('NEW'));
    const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://api.flutterwave.com', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
    const r = await a.initiatePayout(req);
    assert.equal(r.status, 'PENDING');
    assert.equal(r.providerReference, '1864609');
    assert.equal(calls[0]!.url, 'https://api.flutterwave.com/v3/transfers');
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer FLWSECK_TEST-abc');
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.account_bank, 'MTN');
    assert.equal(body.account_number, '260961234567');
    assert.equal(body.amount, 8462.5);
    assert.equal(body.currency, 'ZMW');
    assert.equal(body.debit_currency, 'ZMW');
    assert.equal(body.beneficiary_name, 'Mwila Banda');
    assert.equal(body.reference, flutterwaveReference(req.idempotencyKey));
    assert.equal(a.isSandbox, true);
  });

  test('maps Airtel and Zamtel network codes', async () => {
    for (const [code, bank] of [['AIRTEL_ZM', 'AIRTEL'], ['ZAMTEL_ZM', 'ZAMTEL']] as const) {
      const { calls, fetchImpl } = mockFetch(() => ok('NEW'));
      const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
      await a.initiatePayout({ ...req, recipient: { ...req.recipient, operatorCode: code } });
      assert.equal(JSON.parse(String(calls[0]!.init.body)).account_bank, bank);
    }
  });

  test('status mapping via GET /v3/transfers/:id', async () => {
    for (const [flw, ours] of [['NEW', 'PENDING'], ['PENDING', 'PENDING'], ['SUCCESSFUL', 'SUCCEEDED'], ['FAILED', 'FAILED']] as const) {
      const { calls, fetchImpl } = mockFetch(() => ok(flw, { complete_message: flw === 'FAILED' ? 'Account resolve failed' : '' }));
      const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
      const r = await a.getPayoutStatus(req.idempotencyKey, '1864609');
      assert.equal(r.status, ours, flw);
      assert.equal(calls[0]!.url, 'https://x/v3/transfers/1864609');
      if (flw === 'FAILED') assert.equal(r.failureMessage, 'Account resolve failed');
    }
  });

  test('without an id, status is looked up by our reference', async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ status: 200, body: { status: 'success', data: [{ id: 77, reference: flutterwaveReference(req.idempotencyKey), status: 'SUCCESSFUL' }] } }));
    const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
    const r = await a.getPayoutStatus(req.idempotencyKey);
    assert.equal(r.status, 'SUCCEEDED');
    assert.equal(r.providerReference, '77');
    assert.match(calls[0]!.url, /\/v3\/transfers\?reference=/);
  });

  test('duplicate reference is resolved by lookup, never re-sent', async () => {
    let posts = 0;
    const { fetchImpl } = mockFetch((url, init) => {
      if (init.method === 'POST') {
        posts++;
        return { status: 400, body: { status: 'error', message: 'Transfer with this reference already exists' } };
      }
      return { status: 200, body: { status: 'success', data: [{ id: 99, reference: flutterwaveReference(req.idempotencyKey), status: 'PENDING' }] } };
    });
    const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
    const r = await a.initiatePayout(req);
    assert.equal(r.status, 'PENDING');
    assert.equal(r.providerReference, '99');
    assert.equal(posts, 1);
  });

  test('4xx rejection is FAILED (nothing sent); 5xx and 429 are UNKNOWN (must poll)', async () => {
    const cases: [number, string][] = [[400, 'FAILED'], [401, 'FAILED'], [429, 'UNKNOWN'], [500, 'UNKNOWN'], [503, 'UNKNOWN']];
    for (const [code, expected] of cases) {
      const { fetchImpl } = mockFetch(() => ({ status: code, body: { status: 'error', message: `err ${code}` } }));
      const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
      assert.equal((await a.initiatePayout(req)).status, expected, String(code));
    }
  });

  test('network failure is a retryable error, not a failure', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
    await assert.rejects(() => a.initiatePayout(req), (e: Error & { retryable?: boolean }) => e.retryable === true);
  });

  test('unsupported network or missing key is refused before any call', async () => {
    const { calls, fetchImpl } = mockFetch(() => ok('NEW'));
    const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', fetchImpl });
    await assert.rejects(() => a.initiatePayout({ ...req, recipient: { ...req.recipient, operatorCode: 'VODAFONE' } }), /Unsupported mobile network/);
    const b = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', fetchImpl });
    await assert.rejects(() => b.initiatePayout(req), /not configured/);
    assert.equal(calls.length, 0);
  });

  test('live keys are production; test or missing keys are sandbox', () => {
    assert.equal(new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK-live' }).isSandbox, false);
    assert.equal(new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-x' }).isSandbox, true);
    assert.equal(new FlutterwaveTransfersAdapter({ baseUrl: 'https://x' }).isSandbox, true);
  });

  test('webhook: verif-hash must match the configured secret hash', () => {
    const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', webhookSecretHash: 'a-long-random-secret-hash' });
    const rawBody = Buffer.from(JSON.stringify({ event: 'transfer.completed', 'event.type': 'Transfer', data: { id: 1864609, reference: 'r', status: 'SUCCESSFUL', currency: 'ZMW', complete_message: 'Successful' } }));
    assert.equal(a.verifyWebhook({ headers: { 'verif-hash': 'a-long-random-secret-hash' }, rawBody }), true);
    assert.equal(a.verifyWebhook({ headers: { 'verif-hash': 'wrong-hash-value-xxxxxx' }, rawBody }), false);
    assert.equal(a.verifyWebhook({ headers: {}, rawBody }), false);
    const noHash = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc' });
    assert.equal(noHash.verifyWebhook({ headers: { 'verif-hash': 'anything' }, rawBody }), false);
    const ev = a.parseWebhook({ headers: {}, rawBody });
    assert.equal(ev.kind, 'PAYOUT');
    assert.equal(ev.providerReference, '1864609');
    assert.equal(ev.status, 'SUCCEEDED');
    assert.equal(ev.eventId, 'transfer:1864609:SUCCESSFUL');
  });

  test('non-transfer webhook events are routed to be ignored', () => {
    const a = new FlutterwaveTransfersAdapter({ baseUrl: 'https://x', secretKey: 'FLWSECK_TEST-abc', webhookSecretHash: 'a-long-random-secret-hash' });
    const ev = a.parseWebhook({ headers: {}, rawBody: Buffer.from(JSON.stringify({ event: 'charge.completed', data: { id: 5 } })) });
    assert.equal(ev.kind, 'COLLECTION');
    assert.equal(ev.ourReference, undefined);
  });
});
