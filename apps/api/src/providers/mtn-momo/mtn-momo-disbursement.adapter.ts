/**
 * MTN MoMo Open API — Disbursement product.
 * Docs: https://momodeveloper.mtn.com/  (API user provisioning, token, transfer, status)
 *
 * STATUS: written against the published API shape; NOT yet exercised against the MTN
 * sandbox from this codebase (no network access during initial build). Before use:
 *   1. Subscribe to "Disbursements" on the developer portal and obtain the subscription key.
 *   2. Create an API user + API key (sandbox: POST /v1_0/apiuser, POST /v1_0/apiuser/{id}/apikey).
 *   3. Run test/e2e/mtn-momo.sandbox.e2e-spec.ts with the sandbox credentials.
 * Note: the MTN sandbox only accepts EUR; production in Zambia uses ZMW and requires
 * MTN Zambia commercial onboarding. Callbacks are NOT signed by MTN, so a callback is
 * treated only as a prompt to re-query the status endpoint.
 */
import type { PayoutAdapter, PayoutRequest, ProviderResult } from '../provider.types';
import { ProviderNotConfiguredError, ProviderRequestError } from '../provider.types';
import { currencyInfo, toDecimalString } from '@ebk/core';

export interface MtnMomoConfig {
  baseUrl: string; // https://sandbox.momodeveloper.mtn.com or the production host MTN issues
  targetEnvironment: string; // "sandbox" | e.g. "mtnzambia"
  subscriptionKey?: string;
  apiUser?: string;
  apiKey?: string;
  /** Override currency for sandbox testing (MTN sandbox requires EUR). */
  sandboxCurrencyOverride?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type MtnTransferStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

/** MTN references must be UUIDv4. Derive a stable one from our idempotency key. */
export function idempotencyKeyToUuid(key: string, hash: (s: string) => string): string {
  const h = hash(key); // hex sha256
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class MtnMomoDisbursementAdapter implements PayoutAdapter {
  readonly adapter = 'mtn-momo-disbursement';
  readonly isSandbox: boolean;
  readonly environment: 'SANDBOX' | 'PRODUCTION';
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: MtnMomoConfig, private readonly sha256Hex: (s: string) => string) {
    this.isSandbox = cfg.targetEnvironment === 'sandbox';
    this.environment = this.isSandbox ? 'SANDBOX' : 'PRODUCTION';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private requireCredentials(): { subscriptionKey: string; apiUser: string; apiKey: string } {
    const { subscriptionKey, apiUser, apiKey } = this.cfg;
    if (!subscriptionKey || !apiUser || !apiKey) {
      throw new ProviderNotConfiguredError(this.adapter, 'MTN_MOMO_DISBURSEMENT_* credentials are not set');
    }
    return { subscriptionKey, apiUser, apiKey };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 15000);
    try {
      return await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (e) {
      // Network failure / timeout: outcome unknown, safe to retry because requests are idempotent by X-Reference-Id.
      throw new ProviderRequestError(this.adapter, `Network error calling MTN: ${(e as Error).message}`, true);
    } finally {
      clearTimeout(timer);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const c = this.requireCredentials();
    const res = await this.request('/disbursement/token/', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.apiUser}:${c.apiKey}`).toString('base64')}`,
        'Ocp-Apim-Subscription-Key': c.subscriptionKey,
      },
    });
    if (!res.ok) throw new ProviderRequestError(this.adapter, `MTN token request failed (${res.status})`, res.status >= 500, res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  async healthCheck() {
    try {
      await this.accessToken();
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async initiatePayout(req: PayoutRequest): Promise<ProviderResult> {
    const c = this.requireCredentials();
    if (!req.recipient.msisdn) throw new ProviderRequestError(this.adapter, 'MTN payout requires an MSISDN', false);
    const referenceId = idempotencyKeyToUuid(req.idempotencyKey, this.sha256Hex);
    const currency = this.isSandbox && this.cfg.sandboxCurrencyOverride ? this.cfg.sandboxCurrencyOverride : req.currency;
    const res = await this.request('/disbursement/v1_0/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': this.cfg.targetEnvironment,
        'X-Callback-Url': req.callbackUrl,
        'Ocp-Apim-Subscription-Key': c.subscriptionKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: toDecimalString(req.amountMinor, currencyInfo(req.currency).minorUnits),
        currency,
        externalId: req.transferReference,
        payee: { partyIdType: 'MSISDN', partyId: req.recipient.msisdn },
        payerMessage: req.narration.slice(0, 160),
        payeeNote: `EBK ${req.transferReference}`.slice(0, 160),
      }),
    });
    // 202 Accepted = queued. 409 = duplicate reference: the original request was received; query its status.
    if (res.status === 202 || res.status === 409) return { status: 'PENDING', providerReference: referenceId };
    const text = await res.text().catch(() => '');
    // 4xx (other than 409) means the request was rejected and nothing was sent.
    if (res.status >= 400 && res.status < 500) {
      return { status: 'FAILED', providerReference: referenceId, failureCode: `HTTP_${res.status}`, failureMessage: text.slice(0, 500) };
    }
    // 5xx: outcome unknown — never assume failure (money may have moved). Poll status.
    return { status: 'UNKNOWN', providerReference: referenceId, failureCode: `HTTP_${res.status}`, failureMessage: text.slice(0, 500) };
  }

  async getPayoutStatus(idempotencyKey: string, providerReference?: string): Promise<ProviderResult> {
    const c = this.requireCredentials();
    const referenceId = providerReference ?? idempotencyKeyToUuid(idempotencyKey, this.sha256Hex);
    const res = await this.request(`/disbursement/v1_0/transfer/${referenceId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'X-Target-Environment': this.cfg.targetEnvironment,
        'Ocp-Apim-Subscription-Key': c.subscriptionKey,
      },
    });
    if (res.status === 404) return { status: 'UNKNOWN', providerReference: referenceId, failureCode: 'NOT_FOUND' };
    if (!res.ok) return { status: 'UNKNOWN', providerReference: referenceId, failureCode: `HTTP_${res.status}` };
    const body = (await res.json()) as { status: MtnTransferStatus; financialTransactionId?: string; reason?: string | { code?: string; message?: string } };
    const reason = typeof body.reason === 'string' ? { code: body.reason } : body.reason;
    const map: Record<MtnTransferStatus, ProviderResult['status']> = { PENDING: 'PENDING', SUCCESSFUL: 'SUCCEEDED', FAILED: 'FAILED' };
    return {
      status: map[body.status] ?? 'UNKNOWN',
      providerReference: referenceId,
      failureCode: reason?.code,
      failureMessage: reason?.message,
      raw: { status: body.status, financialTransactionId: body.financialTransactionId, reason },
    };
  }
}
