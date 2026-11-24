/**
 * Airtel Money Zambia — disbursement adapter.
 * Developer portal: https://developers.airtel.co.zm/home
 *
 * STATUS: NOT IMPLEMENTED. Airtel's disbursement API requires merchant onboarding,
 * an encrypted PIN header and RSA public key exchange issued during onboarding.
 * Until those are obtained this adapter is registered but always reports
 * "not configured", so the engine cannot route payouts to it by accident.
 */
import type { PayoutAdapter, PayoutRequest, ProviderResult } from '../provider.types';
import { ProviderNotConfiguredError } from '../provider.types';

export class AirtelMoneyAdapter implements PayoutAdapter {
  readonly adapter = 'airtel-money-disbursement';
  readonly environment = 'SANDBOX' as const;
  readonly isSandbox = true;

  async healthCheck() {
    return { ok: false, detail: 'Airtel Money adapter not implemented — awaiting merchant onboarding' };
  }

  async initiatePayout(_req: PayoutRequest): Promise<ProviderResult> {
    throw new ProviderNotConfiguredError(this.adapter, 'awaiting Airtel Money onboarding and API credentials');
  }

  async getPayoutStatus(): Promise<ProviderResult> {
    throw new ProviderNotConfiguredError(this.adapter, 'awaiting Airtel Money onboarding and API credentials');
  }
}
