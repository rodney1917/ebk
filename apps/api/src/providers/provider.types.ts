/**
 * Provider-independent payment interfaces. The transaction engine only talks to
 * these; MTN, Airtel, card acquirers etc. are adapters registered by code.
 * Amounts are minor-unit BigInts; adapters convert to each provider's format.
 */

export type ProviderEnvironment = 'SANDBOX' | 'PRODUCTION';

/** Normalised provider-side status. UNKNOWN means "ask again" — never assume success. */
export type ProviderOperationStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export interface ProviderResult {
  status: ProviderOperationStatus;
  providerReference?: string;
  failureCode?: string;
  failureMessage?: string;
  /** Sanitised provider response, stored for support/reconciliation (never secrets). */
  raw?: unknown;
}

export interface CollectionRequest {
  idempotencyKey: string; // stable per payment attempt
  transferReference: string;
  amountMinor: bigint;
  currency: string;
  customer: { id: string; email: string; name: string };
  returnUrl: string;
  callbackUrl: string;
}

export interface CollectionInitiation extends ProviderResult {
  /** Hosted payment page (card details are entered on the provider's page, never EBK's). */
  checkoutUrl?: string;
}

export interface RefundRequest {
  idempotencyKey: string;
  providerReference: string;
  amountMinor: bigint;
  currency: string;
  reason: string;
}

export interface PayoutRequest {
  idempotencyKey: string; // stable per payout attempt (used as provider reference where supported)
  transferReference: string;
  amountMinor: bigint;
  currency: string;
  recipient: { fullName: string; msisdn?: string; operatorCode?: string; bankCode?: string; accountNumber?: string };
  narration: string;
  callbackUrl: string;
}

export interface WebhookInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

export interface ParsedWebhookEvent {
  eventId: string; // provider's unique id (for de-duplication)
  eventType: string;
  kind: 'COLLECTION' | 'PAYOUT' | 'REFUND';
  /** Our idempotency key / reference echoed back by the provider, if any */
  ourReference?: string;
  providerReference?: string;
  status: ProviderOperationStatus;
  amountMinor?: bigint;
  currency?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface BaseAdapter {
  readonly adapter: string;
  readonly environment: ProviderEnvironment;
  /** True when the adapter can never move real money (sandbox / simulator). */
  readonly isSandbox: boolean;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
  verifyWebhook?(input: WebhookInput): boolean;
  parseWebhook?(input: WebhookInput): ParsedWebhookEvent;
}

export interface CollectionAdapter extends BaseAdapter {
  initiateCollection(req: CollectionRequest): Promise<CollectionInitiation>;
  getCollectionStatus(idempotencyKey: string, providerReference?: string): Promise<ProviderResult>;
  refund(req: RefundRequest): Promise<ProviderResult>;
}

export interface PayoutAdapter extends BaseAdapter {
  initiatePayout(req: PayoutRequest): Promise<ProviderResult>;
  getPayoutStatus(idempotencyKey: string, providerReference?: string): Promise<ProviderResult>;
  /** Optional — not all mobile money operators support reversals. */
  reversePayout?(providerReference: string, reason: string): Promise<ProviderResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(adapter: string, detail: string) {
    super(`Provider adapter "${adapter}" is not configured: ${detail}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class ProviderRequestError extends Error {
  constructor(
    public readonly adapter: string,
    message: string,
    /** Whether retrying the same idempotent request is safe and sensible */
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}
