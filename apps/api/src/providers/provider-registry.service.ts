import { Injectable, Logger, Module, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentProvider, PayoutProvider } from '@prisma/client';
import { sha256 } from '../common/crypto';
import { env, isProduction } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AirtelMoneyAdapter } from './airtel-money/airtel-money.adapter';
import { MtnMomoDisbursementAdapter } from './mtn-momo/mtn-momo-disbursement.adapter';
import type { CollectionAdapter, PayoutAdapter } from './provider.types';
import { SandboxCollectionAdapter, SandboxPayoutAdapter } from './sandbox/sandbox.adapters';

/**
 * Resolves provider rows (payment_providers / payout_providers) to adapter instances.
 * Secrets come from the environment / secret store via `credentials_ref`; the database
 * only stores non-secret configuration.
 */
@Injectable()
export class ProviderRegistry {
  private readonly log = new Logger(ProviderRegistry.name);
  private readonly collection = new Map<string, CollectionAdapter>();
  private readonly payout = new Map<string, PayoutAdapter>();

  constructor(private readonly prisma: PrismaService) {}

  private buildCollection(row: PaymentProvider): CollectionAdapter {
    const cfg = env();
    switch (row.adapter) {
      case 'sandbox-collection':
        if (isProduction() || !cfg.SANDBOX_PROVIDERS_ENABLED) throw new ServiceUnavailableException('Sandbox collection is disabled');
        return new SandboxCollectionAdapter({
          nodeEnv: cfg.NODE_ENV,
          webhookSecret: cfg.SANDBOX_WEBHOOK_SECRET!,
          checkoutBaseUrl: `${cfg.API_PUBLIC_URL}/api/sandbox/checkout`,
        });
      default:
        // UK card / open-banking acquirer adapter to be added once a partner is selected.
        throw new ServiceUnavailableException(`No collection adapter "${row.adapter}"`);
    }
  }

  private buildPayout(row: PayoutProvider): PayoutAdapter {
    const cfg = env();
    switch (row.adapter) {
      case 'sandbox-payout':
        if (isProduction() || !cfg.SANDBOX_PROVIDERS_ENABLED) throw new ServiceUnavailableException('Sandbox payout is disabled');
        return new SandboxPayoutAdapter({ nodeEnv: cfg.NODE_ENV });
      case 'mtn-momo-disbursement':
        return new MtnMomoDisbursementAdapter(
          {
            baseUrl: cfg.MTN_MOMO_BASE_URL,
            targetEnvironment: cfg.MTN_MOMO_TARGET_ENVIRONMENT,
            subscriptionKey: cfg.MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY,
            apiUser: cfg.MTN_MOMO_DISBURSEMENT_API_USER,
            apiKey: cfg.MTN_MOMO_DISBURSEMENT_API_KEY,
            sandboxCurrencyOverride: (row.config as unknown as { sandboxCurrencyOverride?: string } | null)?.sandboxCurrencyOverride,
          },
          sha256,
        );
      case 'airtel-money-disbursement':
        return new AirtelMoneyAdapter();
      default:
        throw new ServiceUnavailableException(`No payout adapter "${row.adapter}"`);
    }
  }

  /** Never route production traffic through a sandbox row, or sandbox traffic in production. */
  private assertEnvironment(row: { code: string; environment: 'SANDBOX' | 'PRODUCTION' }, isSandboxAdapter: boolean) {
    if (isProduction() && (row.environment !== 'PRODUCTION' || isSandboxAdapter)) {
      throw new ServiceUnavailableException(`Provider ${row.code} is not a production provider`);
    }
  }

  collectionAdapter(row: PaymentProvider): CollectionAdapter {
    let a = this.collection.get(row.id);
    if (!a) {
      a = this.buildCollection(row);
      this.collection.set(row.id, a);
    }
    this.assertEnvironment(row, a.isSandbox);
    return a;
  }

  payoutAdapter(row: PayoutProvider): PayoutAdapter {
    let a = this.payout.get(row.id);
    if (!a) {
      a = this.buildPayout(row);
      this.payout.set(row.id, a);
    }
    this.assertEnvironment(row, a.isSandbox);
    return a;
  }

  async selectCollectionProvider(currency: string, country: string): Promise<PaymentProvider> {
    const rows = await this.prisma.paymentProvider.findMany({
      where: { active: true, supportedCurrencies: { has: currency }, supportedCountries: { has: country }, environment: isProduction() ? 'PRODUCTION' : undefined },
      orderBy: { priority: 'desc' },
    });
    if (!rows[0]) throw new ServiceUnavailableException({ code: 'NO_COLLECTION_PROVIDER', message: 'Payments are temporarily unavailable' });
    return rows[0];
  }

  async selectPayoutProvider(country: string, method: 'MOBILE_MONEY' | 'BANK_ACCOUNT', operatorCode?: string): Promise<PayoutProvider> {
    const rows = await this.prisma.payoutProvider.findMany({
      where: {
        active: true,
        countryCode: country,
        payoutMethod: method,
        ...(operatorCode ? { mobileOperatorCodes: { has: operatorCode } } : {}),
        environment: isProduction() ? 'PRODUCTION' : undefined,
      },
      orderBy: { priority: 'desc' },
    });
    if (!rows[0]) throw new ServiceUnavailableException({ code: 'NO_PAYOUT_PROVIDER', message: 'Payouts to this network are temporarily unavailable' });
    return rows[0];
  }

  async adapterForWebhook(providerCode: string): Promise<CollectionAdapter | PayoutAdapter | null> {
    const pay = await this.prisma.paymentProvider.findUnique({ where: { code: providerCode } });
    if (pay) return this.collectionAdapter(pay);
    const out = await this.prisma.payoutProvider.findUnique({ where: { code: providerCode } });
    if (out) return this.payoutAdapter(out);
    this.log.warn(`Webhook for unknown provider ${providerCode}`);
    return null;
  }
}

@Module({ providers: [ProviderRegistry], exports: [ProviderRegistry] })
export class ProvidersModule {}
