/**
 * ============================  SANDBOX ONLY  ============================
 * Simulated collection and payout partners for development and testing.
 * They never contact a bank or mobile-money operator and never move money.
 * They refuse to construct when NODE_ENV=production, every result they produce is
 * tagged `sandbox: true`, and transfers created through them carry rate kind SANDBOX.
 * =========================================================================
 */
import type {
  CollectionAdapter, CollectionInitiation, CollectionRequest, ParsedWebhookEvent, PayoutAdapter,
  PayoutRequest, ProviderResult, RefundRequest, WebhookInput,
} from '../provider.types';
import { SANDBOX_SIGNATURE_HEADER, verifySandboxSignature } from './sandbox-signing';

function assertNotProduction(nodeEnv: string): void {
  if (nodeEnv === 'production') {
    throw new Error('EBK sandbox adapters cannot be used in production');
  }
}

function header(input: WebhookInput, name: string): string | undefined {
  const v = input.headers[name] ?? input.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export interface SandboxCollectionWebhookBody {
  id: string; // event id
  type: 'collection.succeeded' | 'collection.failed' | 'refund.succeeded';
  data: { idempotencyKey: string; providerReference: string; amountMinor: string; currency: string; failureCode?: string };
}

export class SandboxCollectionAdapter implements CollectionAdapter {
  readonly adapter = 'sandbox-collection';
  readonly environment = 'SANDBOX' as const;
  readonly isSandbox = true;

  constructor(
    private readonly opts: { nodeEnv: string; webhookSecret: string; checkoutBaseUrl: string },
  ) {
    assertNotProduction(opts.nodeEnv);
  }

  async healthCheck() {
    return { ok: true, detail: 'Sandbox simulator (no external connection)' };
  }

  async initiateCollection(req: CollectionRequest): Promise<CollectionInitiation> {
    return {
      status: 'PENDING',
      providerReference: `sbx_col_${req.idempotencyKey.slice(-12)}`,
      checkoutUrl: `${this.opts.checkoutBaseUrl}/${encodeURIComponent(req.idempotencyKey)}`,
      raw: { sandbox: true },
    };
  }

  /** The simulator keeps no state of its own; status comes from signed webhooks. */
  async getCollectionStatus(): Promise<ProviderResult> {
    return { status: 'UNKNOWN', raw: { sandbox: true, note: 'Sandbox collection status is delivered by webhook' } };
  }

  async refund(req: RefundRequest): Promise<ProviderResult> {
    return { status: 'SUCCEEDED', providerReference: `sbx_ref_${req.idempotencyKey.slice(-12)}`, raw: { sandbox: true } };
  }

  verifyWebhook(input: WebhookInput): boolean {
    return verifySandboxSignature(this.opts.webhookSecret, header(input, SANDBOX_SIGNATURE_HEADER), input.rawBody);
  }

  parseWebhook(input: WebhookInput): ParsedWebhookEvent {
    const body = JSON.parse(input.rawBody.toString('utf8')) as SandboxCollectionWebhookBody;
    return {
      eventId: body.id,
      eventType: body.type,
      kind: body.type.startsWith('refund') ? 'REFUND' : 'COLLECTION',
      ourReference: body.data.idempotencyKey,
      providerReference: body.data.providerReference,
      status: body.type.endsWith('succeeded') ? 'SUCCEEDED' : 'FAILED',
      amountMinor: BigInt(body.data.amountMinor),
      currency: body.data.currency,
      failureCode: body.data.failureCode,
    };
  }
}

/**
 * Sandbox payout simulator. Outcome is chosen by the recipient number so every path
 * can be tested deterministically:
 *   ends in 0000  -> FAILED (PAYEE_NOT_FOUND)
 *   ends in 9999  -> stays PENDING (timeout / polling path)
 *   otherwise     -> SUCCEEDED on the first status check after `settleAfterMs`
 */
export class SandboxPayoutAdapter implements PayoutAdapter {
  readonly adapter = 'sandbox-payout';
  readonly environment = 'SANDBOX' as const;
  readonly isSandbox = true;
  private readonly payouts = new Map<string, { msisdn: string; createdAt: number; providerReference: string }>();

  constructor(private readonly opts: { nodeEnv: string; settleAfterMs?: number }) {
    assertNotProduction(opts.nodeEnv);
  }

  async healthCheck() {
    return { ok: true, detail: 'Sandbox simulator (no external connection)' };
  }

  async initiatePayout(req: PayoutRequest): Promise<ProviderResult> {
    const existing = this.payouts.get(req.idempotencyKey);
    if (existing) return { status: 'PENDING', providerReference: existing.providerReference, raw: { sandbox: true, duplicate: true } };
    const providerReference = `sbx_pay_${req.idempotencyKey.slice(-12)}`;
    this.payouts.set(req.idempotencyKey, { msisdn: req.recipient.msisdn ?? '', createdAt: Date.now(), providerReference });
    return { status: 'PENDING', providerReference, raw: { sandbox: true } };
  }

  async getPayoutStatus(idempotencyKey: string): Promise<ProviderResult> {
    const p = this.payouts.get(idempotencyKey);
    if (!p) return { status: 'UNKNOWN', raw: { sandbox: true, note: 'Unknown to simulator (restarted?)' } };
    if (p.msisdn.endsWith('0000')) {
      return { status: 'FAILED', providerReference: p.providerReference, failureCode: 'PAYEE_NOT_FOUND', failureMessage: 'Sandbox: recipient account not found', raw: { sandbox: true } };
    }
    if (p.msisdn.endsWith('9999')) return { status: 'PENDING', providerReference: p.providerReference, raw: { sandbox: true } };
    if (Date.now() - p.createdAt < (this.opts.settleAfterMs ?? 3000)) {
      return { status: 'PENDING', providerReference: p.providerReference, raw: { sandbox: true } };
    }
    return { status: 'SUCCEEDED', providerReference: p.providerReference, raw: { sandbox: true } };
  }
}
