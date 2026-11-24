/**
 * Flutterwave v3 Transfers — payouts to Zambian mobile money (MTN, Airtel, Zamtel).
 * Docs: https://developer.flutterwave.com/docs/zambia-1 · /docs/making-payments/transfers/overview
 *
 *   POST /v3/transfers            { account_bank: "MTN"|"AIRTEL"|"ZAMTEL", account_number: "2609…",
 *                                   amount, currency: "ZMW", debit_currency, narration, reference,
 *                                   beneficiary_name, callback_url }
 *   GET  /v3/transfers/:id        status NEW | PENDING | SUCCESSFUL | FAILED (complete_message = reason)
 *   GET  /v3/transfers?reference= lookup by our reference (used when we never got the id back)
 *   Webhook event "transfer.completed"; authenticity via the `verif-hash` header, which equals the
 *   secret hash configured in the Flutterwave dashboard (Settings → Webhooks).
 *
 * Test vs live is decided by the secret key (FLWSECK_TEST-… = test mode, never real money).
 * Because verif-hash is a static shared secret (no payload signature), the engine re-queries the
 * transfer status after every webhook rather than trusting the webhook body.
 */
import { currencyInfo, toDecimalString } from '@ebk/core';
import { safeEqual } from '../../common/crypto';
import type { ParsedWebhookEvent, PayoutAdapter, PayoutRequest, ProviderResult, WebhookInput } from '../provider.types';
import { ProviderNotConfiguredError, ProviderRequestError } from '../provider.types';

export interface FlutterwaveConfig {
  baseUrl: string; // https://api.flutterwave.com
  secretKey?: string;
  webhookSecretHash?: string;
  /** EBK operator code -> Flutterwave account_bank value */
  operatorMap?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_OPERATOR_MAP: Record<string, string> = { MTN_ZM: 'MTN', AIRTEL_ZM: 'AIRTEL', ZAMTEL_ZM: 'ZAMTEL' };

type FlwStatus = 'NEW' | 'PENDING' | 'SUCCESSFUL' | 'FAILED';
interface FlwTransfer {
  id: number;
  reference: string;
  status: FlwStatus;
  complete_message?: string;
  amount?: number;
  currency?: string;
  fee?: number;
}

/** Flutterwave references: keep to [A-Za-z0-9_-]. Deterministic, so retries reuse the same reference. */
export function flutterwaveReference(idempotencyKey: string): string {
  return idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}

function mapStatus(s: string | undefined): ProviderResult['status'] {
  switch (s) {
    case 'SUCCESSFUL':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'NEW':
    case 'PENDING':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

function toResult(t: FlwTransfer): ProviderResult {
  const status = mapStatus(t.status);
  return {
    status,
    providerReference: String(t.id),
    failureCode: status === 'FAILED' ? 'FLW_TRANSFER_FAILED' : undefined,
    failureMessage: status === 'FAILED' ? t.complete_message || 'Transfer failed' : undefined,
    raw: { id: t.id, reference: t.reference, status: t.status, complete_message: t.complete_message, fee: t.fee },
  };
}

export class FlutterwaveTransfersAdapter implements PayoutAdapter {
  readonly adapter = 'flutterwave-transfers';
  readonly isSandbox: boolean;
  readonly environment: 'SANDBOX' | 'PRODUCTION';
  private readonly fetchImpl: typeof fetch;
  private readonly operatorMap: Record<string, string>;

  constructor(private readonly cfg: FlutterwaveConfig) {
    // Unconfigured or test keys are treated as sandbox, so they can never pass a production check.
    this.isSandbox = !cfg.secretKey || cfg.secretKey.startsWith('FLWSECK_TEST');
    this.environment = this.isSandbox ? 'SANDBOX' : 'PRODUCTION';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.operatorMap = { ...DEFAULT_OPERATOR_MAP, ...(cfg.operatorMap ?? {}) };
  }

  private key(): string {
    if (!this.cfg.secretKey) throw new ProviderNotConfiguredError(this.adapter, 'FLW_SECRET_KEY is not set');
    return this.cfg.secretKey;
  }

  private async call(path: string, init: RequestInit): Promise<{ status: number; body: { status?: string; message?: string; data?: unknown } }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 20000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) throw e;
      throw new ProviderRequestError(this.adapter, `Network error calling Flutterwave: ${(e as Error).message}`, true);
    } finally {
      clearTimeout(timer);
    }
    const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: unknown };
    return { status: res.status, body };
  }

  async healthCheck() {
    try {
      const r = await this.call('/v3/balances/ZMW', { method: 'GET' });
      return r.status === 200 ? { ok: true } : { ok: false, detail: `Balance check returned HTTP ${r.status}: ${r.body.message ?? ''}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async initiatePayout(req: PayoutRequest): Promise<ProviderResult> {
    const bank = req.recipient.operatorCode ? this.operatorMap[req.recipient.operatorCode] : undefined;
    if (!bank) throw new ProviderRequestError(this.adapter, `Unsupported mobile network ${req.recipient.operatorCode ?? '(none)'}`, false);
    if (!req.recipient.msisdn) throw new ProviderRequestError(this.adapter, 'Recipient mobile number missing', false);

    const reference = flutterwaveReference(req.idempotencyKey);
    const amount = toDecimalString(req.amountMinor, currencyInfo(req.currency).minorUnits);
    const r = await this.call('/v3/transfers', {
      method: 'POST',
      body: JSON.stringify({
        account_bank: bank,
        account_number: req.recipient.msisdn, // E.164 digits, e.g. 2609XXXXXXXX
        amount: Number(amount), // Flutterwave expects a JSON number; value is exact to 2 dp
        currency: req.currency,
        debit_currency: req.currency,
        narration: req.narration.slice(0, 100),
        reference,
        beneficiary_name: req.recipient.fullName,
        callback_url: req.callbackUrl,
        meta: { ebk_reference: req.transferReference },
      }),
    });

    if (r.status === 200 && r.body.status === 'success' && r.body.data) return toResult(r.body.data as FlwTransfer);

    const message = String(r.body.message ?? '');
    // Duplicate reference: the original request reached Flutterwave. Look it up instead of re-sending.
    if (/already exist|duplicate/i.test(message)) {
      const existing = await this.findByReference(reference);
      return existing ?? { status: 'UNKNOWN', failureCode: 'FLW_DUPLICATE_LOOKUP_FAILED', failureMessage: message };
    }
    // 4xx (except 408/429) = rejected before any money moved.
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
      return { status: 'FAILED', failureCode: `FLW_HTTP_${r.status}`, failureMessage: message.slice(0, 500) };
    }
    // 5xx / timeouts / rate limits: outcome unknown — poll by reference, never assume.
    return { status: 'UNKNOWN', failureCode: `FLW_HTTP_${r.status}`, failureMessage: message.slice(0, 500) };
  }

  private async findByReference(reference: string): Promise<ProviderResult | null> {
    const r = await this.call(`/v3/transfers?reference=${encodeURIComponent(reference)}`, { method: 'GET' });
    const list = Array.isArray(r.body.data) ? (r.body.data as FlwTransfer[]) : [];
    const match = list.find((t) => t.reference === reference);
    return match ? toResult(match) : null;
  }

  async getPayoutStatus(idempotencyKey: string, providerReference?: string): Promise<ProviderResult> {
    if (providerReference && /^\d+$/.test(providerReference)) {
      const r = await this.call(`/v3/transfers/${providerReference}`, { method: 'GET' });
      if (r.status === 200 && r.body.data) return toResult(r.body.data as FlwTransfer);
      return { status: 'UNKNOWN', providerReference, failureCode: `FLW_HTTP_${r.status}` };
    }
    // Never got an id back (e.g. timeout on create): look up by our deterministic reference.
    const found = await this.findByReference(flutterwaveReference(idempotencyKey));
    return found ?? { status: 'UNKNOWN', failureCode: 'FLW_NOT_FOUND' };
  }

  verifyWebhook(input: WebhookInput): boolean {
    if (!this.cfg.webhookSecretHash) return false;
    const h = input.headers['verif-hash'];
    const value = Array.isArray(h) ? h[0] : h;
    return !!value && safeEqual(value, this.cfg.webhookSecretHash);
  }

  parseWebhook(input: WebhookInput): ParsedWebhookEvent {
    const body = JSON.parse(input.rawBody.toString('utf8')) as { event?: string; 'event.type'?: string; data?: FlwTransfer };
    const d = body.data;
    const isTransfer = (body.event ?? '').startsWith('transfer') && !!d && typeof d.id === 'number';
    if (!isTransfer) {
      // Not a payout event (e.g. a collection on the same account): recorded and ignored by the engine.
      return { eventId: `other:${body.event ?? 'unknown'}:${(d as { id?: unknown } | undefined)?.id ?? input.rawBody.length}`, eventType: body.event ?? 'unknown', kind: 'COLLECTION', status: 'UNKNOWN' };
    }
    return {
      // Same transfer can notify more than once as status changes; include status in the dedup id.
      eventId: `transfer:${d!.id}:${d!.status}`,
      eventType: body.event ?? 'unknown',
      kind: 'PAYOUT',
      providerReference: String(d!.id),
      status: mapStatus(d!.status),
      currency: d!.currency,
      failureMessage: d!.complete_message,
    };
  }
}
