/**
 * API client. The access token lives only in memory; the refresh token is an httpOnly
 * cookie the browser sends to /api/auth/* only. Every request carries X-EBK-Client so the
 * API can reject cross-site cookie use (see SECURITY.md).
 */
import type { ApiErrorBody, Beneficiary, BeneficiaryInput, Corridor, Me, Page, QuoteDto, ReceiptDto, TransferDto } from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: ApiErrorBody) {
    super(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Something went wrong. Please try again.');
    this.name = 'ApiError';
  }
  get code() {
    return this.body.code;
  }
  fieldError(path: string) {
    return this.body.fields?.find((f) => f.path === path)?.message;
  }
}

export interface Transport {
  request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
}

type TokenListener = (token: string | null) => void;

export class HttpTransport implements Transport {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<TokenListener>();

  constructor(private readonly baseUrl: string) {}

  onToken(l: TokenListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  setToken(token: string | null) {
    this.accessToken = token;
    this.listeners.forEach((l) => l(token));
  }

  private async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'X-EBK-Client': 'web',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** Single-flight refresh so parallel 401s trigger one refresh. */
  refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-EBK-Client': 'web' } });
        if (!res.ok) {
          this.setToken(null);
          return false;
        }
        this.setToken(((await res.json()) as { accessToken: string }).accessToken);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    let res = await this.raw(method, path, body, headers);
    if (res.status === 401 && !path.startsWith('/auth/') && (await this.refresh())) {
      res = await this.raw(method, path, body, headers);
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) throw new ApiError(res.status, json as ApiErrorBody);
    return json as T;
  }
}

export function createApi(t: Transport) {
  return {
    auth: {
      login: (email: string, password: string) => t.request<{ accessToken: string }>('POST', '/auth/login', { email, password }),
      register: (input: { email: string; password: string; firstName: string; lastName: string; countryOfResidence: string }) =>
        t.request<{ accessToken: string }>('POST', '/auth/register', input),
      logout: () => t.request<void>('POST', '/auth/logout'),
      me: () => t.request<Me>('GET', '/auth/me'),
    },
    corridors: () => t.request<Corridor[]>('GET', '/reference-data/corridors'),
    quotes: {
      estimate: (b: { corridorId: string; payoutMethod: string; sendAmount: string }) => t.request<QuoteDto>('POST', '/quotes/estimate', b),
      lock: (b: { corridorId: string; payoutMethod: string; sendAmount: string }) => t.request<QuoteDto>('POST', '/quotes', b),
    },
    beneficiaries: {
      list: () => t.request<Beneficiary[]>('GET', '/beneficiaries'),
      create: (b: BeneficiaryInput) => t.request<Beneficiary>('POST', '/beneficiaries', b),
      update: (id: string, b: BeneficiaryInput) => t.request<Beneficiary>('PATCH', `/beneficiaries/${id}`, b),
      remove: (id: string) => t.request<void>('DELETE', `/beneficiaries/${id}`),
    },
    transfers: {
      list: (q: { status?: string; cursor?: string; limit?: number } = {}) => {
        const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
        return t.request<Page<TransferDto>>('GET', `/transfers${qs.size ? `?${qs}` : ''}`);
      },
      get: (id: string) => t.request<TransferDto>('GET', `/transfers/${id}`),
      receipt: (id: string) => t.request<ReceiptDto>('GET', `/transfers/${id}/receipt`),
      create: (b: { quoteId: string; beneficiaryId: string }, idempotencyKey: string) =>
        t.request<TransferDto>('POST', '/transfers', b, { 'Idempotency-Key': idempotencyKey }),
      confirm: (id: string, idempotencyKey: string) =>
        t.request<{ checkoutUrl: string | null; paymentStatus: string; sandbox: boolean }>('POST', `/transfers/${id}/confirm`, undefined, { 'Idempotency-Key': idempotencyKey }),
      cancel: (id: string) => t.request<TransferDto>('POST', `/transfers/${id}/cancel`),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
